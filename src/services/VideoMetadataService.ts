/**
 * Service pour extraire les métadonnées vidéo et gérer le downscaling
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { uploadVideoToGCS } from '../config/gcs';

const execAsync = promisify(exec);

export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
  quality: 'SD' | '720p' | '1080p' | '2K' | '4K' | '8K';
  fps?: number;
  bitrate?: string;
}

/**
 * Extrait les métadonnées d'une vidéo depuis une URL
 */
export const extractVideoMetadata = async (videoUrl: string): Promise<VideoMetadata> => {
  try {
    // Utiliser ffprobe pour extraire les métadonnées
    const ffprobeCommand = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,r_frame_rate -of default=noprint_wrappers=1 "${videoUrl}"`;

    const { stdout } = await execAsync(ffprobeCommand, { timeout: 30000 });

    const metadata = parseFFProbeOutput(stdout);
    return metadata;
  } catch (error) {
    console.error('Error extracting video metadata:', error);
    throw new Error('Impossible d\'extraire les métadonnées de la vidéo');
  }
};

/**
 * Parse la sortie ffprobe
 */
const parseFFProbeOutput = (output: string): VideoMetadata => {
  const lines = output.split('\n');
  const data: any = {};

  lines.forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
      data[key] = value;
    }
  });

  const width = parseInt(data.width || '0', 10);
  const height = parseInt(data.height || '0', 10);
  const duration = parseFloat(data.duration || '0');
  const fps = data.r_frame_rate ? evaluateFPS(data.r_frame_rate) : undefined;

  const quality = getQualityLabel(width, height);

  return {
    width,
    height,
    duration,
    quality,
    fps,
  };
};

/**
 * Évalue la notation FPS (ex: "30000/1001" → 29.97)
 */
const evaluateFPS = (fpsStr: string): number => {
  if (fpsStr.includes('/')) {
    const [num, den] = fpsStr.split('/').map(Number);
    return num / den;
  }
  return parseFloat(fpsStr);
};

/**
 * Détermine la qualité basée sur la résolution
 */
export const getQualityLabel = (width: number, height: number): VideoMetadata['quality'] => {
  const maxDimension = Math.max(width, height);

  if (maxDimension >= 7680) return '8K';
  if (maxDimension >= 3840) return '4K';
  if (maxDimension >= 2560) return '2K';
  if (maxDimension >= 1920) return '1080p';
  if (maxDimension >= 1280) return '720p';

  return 'SD';
};

/**
 * Retourne les options de qualité disponibles basées sur la qualité originale
 */
export const getAvailableQualities = (originalQuality: VideoMetadata['quality']): string[] => {
  const qualityMap: Record<string, string[]> = {
    '8K': ['4K', '2K', '1080p', '720p'],
    '4K': ['2K', '1080p', '720p'],
    '2K': ['1080p', '720p'],
    '1080p': ['720p'],
    '720p': [],
    'SD': [],
  };

  return qualityMap[originalQuality] || [];
};

/**
 * Valide et nettoie les métadonnées
 */
export const validateMetadata = (metadata: any): VideoMetadata | null => {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const width = parseInt(metadata.width, 10);
  const height = parseInt(metadata.height, 10);
  const duration = parseFloat(metadata.duration);

  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(duration)) {
    return null;
  }

  const quality = getQualityLabel(width, height);

  return {
    width,
    height,
    duration,
    quality,
    fps: metadata.fps ? parseFloat(metadata.fps) : undefined,
    bitrate: metadata.bitrate || undefined,
  };
};

/**
 * Downscale une vidéo et l'upload vers GCS
 */
export const downscaleAndUploadVideo = async (
  videoUrl: string,
  targetQuality: string,
  originalMetadata: VideoMetadata
): Promise<string> => {
  const qualityResolutions: Record<string, { width: number; height: number; bitrate: string }> = {
    '1080p': { width: 1920, height: 1080, bitrate: '5000k' },
    '2K': { width: 2560, height: 1440, bitrate: '8000k' },
    '4K': { width: 3840, height: 2160, bitrate: '15000k' },
    '720p': { width: 1280, height: 720, bitrate: '2500k' },
    'SD': { width: 854, height: 480, bitrate: '1000k' },
  };

  const targetRes = qualityResolutions[targetQuality];
  if (!targetRes) throw new Error(`Quality ${targetQuality} not supported`);

  try {
    // Créer un fichier temporaire
    const tempDir = process.env.TMPDIR || process.env.TEMP || '/tmp';
    const tempOutputFile = path.join(tempDir, `video_${targetQuality}_${Date.now()}.mp4`);

    // Commander FFmpeg pour downscaler.
    //
    // `-preset veryfast` + `-threads 0` (= all available cores) brings the
    // encode rate from ~0.5× realtime to ~3-4× realtime on the Job's 2-vCPU
    // sizing. Bitrate is capped per target so the file size stays under
    // control even with a faster preset.
    //
    // `-vf scale=…:force_original_aspect_ratio=decrease,pad=…` keeps the
    // aspect ratio and pads if needed — without it portrait 9/16 sources
    // get squashed into landscape boxes.
    //
    // Audio is re-encoded with libfdk_aac unavailable on Debian → fall back
    // to native `aac` at 128k which is fine for delivery-quality.
    const ffmpegCommand = [
      `ffmpeg -hide_banner -loglevel error -nostdin`,
      `-i "${videoUrl}"`,
      `-vf "scale=${targetRes.width}:${targetRes.height}:force_original_aspect_ratio=decrease,pad=${targetRes.width}:${targetRes.height}:(ow-iw)/2:(oh-ih)/2"`,
      `-c:v libx264 -preset veryfast -b:v ${targetRes.bitrate} -maxrate ${targetRes.bitrate} -bufsize ${parseInt(targetRes.bitrate) * 2}k`,
      `-c:a aac -b:a 128k`,
      `-movflags +faststart`,
      `-threads 0`,
      `"${tempOutputFile}" -y`,
    ].join(' ');

    console.log(`🎬 Downscaling video to ${targetQuality}...`);
    // 50 min timeout — Cloud Run Job has a 1h ceiling and this MUST
    // expire before the Job's own timeout so we get a clean error
    // rather than a SIGKILL.
    await execAsync(ffmpegCommand, { timeout: 50 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 });

    // Vérifier que le fichier existe
    if (!fs.existsSync(tempOutputFile)) {
      throw new Error('Output file not created');
    }

    // Upload vers GCS with Content-Disposition: attachment so the
    // browser always saves the file when the URL is opened, even on
    // mobile cross-origin where the front can't force a download via
    // JS. The filename here is just a fallback — the front sets a
    // nicer one via the anchor `download` attribute.
    console.log(`📤 Uploading ${targetQuality} version to GCS...`);
    const filename = `video_${targetQuality}_${Date.now()}.mp4`;
    const gcsResult = await uploadVideoToGCS(
      tempOutputFile,
      filename,
      `attachment; filename="${filename}"`
    );

    // Nettoyer le fichier temporaire
    if (fs.existsSync(tempOutputFile)) {
      fs.unlinkSync(tempOutputFile);
    }

    console.log(`✅ ${targetQuality} version uploaded: ${gcsResult.url}`);
    return gcsResult.url;
  } catch (error) {
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    // Surface ffmpeg stderr too — execAsync attaches it on the error
    // object when the exit code is non-zero.
    const stderr = (error as { stderr?: unknown } | null)?.stderr;
    const stderrTail =
      typeof stderr === 'string' ? stderr.split('\n').slice(-10).join('\n') : '';
    console.error(`Error downscaling to ${targetQuality}:`, error);
    throw new Error(
      `Erreur lors du downscaling vers ${targetQuality}: ${detail}${
        stderrTail ? ` | ffmpeg stderr (tail): ${stderrTail}` : ''
      }`
    );
  }
};

/**
 * Quality strings that the HLS worker emits as variant directories
 * (`hls/<uuid>/<quality>/playlist.m3u8`). Anything else has to go
 * through the slow re-encode path in `downscaleAndUploadVideo`.
 *
 * `SD` is the downscale-side label for what HLS calls `480p`, so we
 * accept both and normalise inside `remuxHlsVariantToMp4`.
 */
const HLS_VARIANT_QUALITIES = new Set(['240p', '480p', '720p', '1080p', 'SD']);

function hlsVariantNameFor(targetQuality: string): string | null {
  if (targetQuality === 'SD' || targetQuality === '480p') return '480p';
  if (HLS_VARIANT_QUALITIES.has(targetQuality)) return targetQuality;
  return null;
}

/**
 * Fast-path for the downscale worker: when the HLS ladder already
 * contains the target quality, we just remux those TS segments into
 * an MP4 container — no re-encoding. A 14-min source goes from ~4 min
 * (libx264 veryfast) down to ~30 s (pure I/O + container rewrite).
 *
 * Returns the public URL of the uploaded MP4 on success, or `null`
 * if HLS isn't available for this quality (caller falls back to the
 * full encode path).
 */
export const remuxHlsVariantToMp4 = async (
  hlsMasterUrl: string | null | undefined,
  targetQuality: string
): Promise<string | null> => {
  const variantName = hlsVariantNameFor(targetQuality);
  if (!hlsMasterUrl || !variantName) return null;

  // Derive `<base>/hls/<uuid>/<variant>/playlist.m3u8` from the master
  // URL. The HLS worker always uploads its files in this layout:
  //   hls/<uuid>/master.m3u8
  //   hls/<uuid>/<variant>/playlist.m3u8
  // …so the substitution is mechanical.
  const variantUrl = hlsMasterUrl.replace(/master\.m3u8(\?.*)?$/, `${variantName}/playlist.m3u8`);
  if (variantUrl === hlsMasterUrl) {
    // Master URL didn't match the expected shape — bail out cleanly.
    console.warn(`[remux] unexpected master URL shape: ${hlsMasterUrl}`);
    return null;
  }

  try {
    const tempDir = process.env.TMPDIR || process.env.TEMP || '/tmp';
    const tempOutputFile = path.join(tempDir, `video_${variantName}_remux_${Date.now()}.mp4`);

    // -c copy        no re-encode, just repackage segments
    // -bsf:a aac_adtstoasc   required when copying AAC from TS (ADTS)
    //                        into MP4 (raw AAC / ASC)
    // -movflags +faststart   front-of-file moov atom for fast download
    //                        progress + instant playback
    const cmd = [
      `ffmpeg -hide_banner -loglevel error -nostdin`,
      `-i "${variantUrl}"`,
      `-c copy`,
      `-bsf:a aac_adtstoasc`,
      `-movflags +faststart`,
      `"${tempOutputFile}" -y`,
    ].join(' ');

    console.log(`🔀 Remuxing HLS ${variantName} to MP4 (no re-encode)...`);
    // 10-min ceiling: remux is I/O-bound, even a 2h source finishes in
    // a couple of minutes. Anything longer is a sign the HLS playlist
    // is broken — fail fast and let the caller fall back.
    await execAsync(cmd, { timeout: 10 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 });

    if (!fs.existsSync(tempOutputFile)) {
      throw new Error('Output file not created');
    }

    const filename = `video_${variantName}_${Date.now()}.mp4`;
    console.log(`📤 Uploading ${variantName} remux to GCS...`);
    const gcsResult = await uploadVideoToGCS(
      tempOutputFile,
      filename,
      `attachment; filename="${filename}"`
    );

    if (fs.existsSync(tempOutputFile)) fs.unlinkSync(tempOutputFile);

    console.log(`✅ ${variantName} remux uploaded: ${gcsResult.url}`);
    return gcsResult.url;
  } catch (error) {
    // Don't throw — caller falls back to the full encode path. Log
    // loudly so we can tell from metrics how often remux fails and
    // why (broken playlist, missing variant, etc.).
    const detail =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const stderr = (error as { stderr?: unknown } | null)?.stderr;
    const stderrTail =
      typeof stderr === 'string' ? stderr.split('\n').slice(-10).join('\n') : '';
    console.warn(
      `[remux] HLS remux failed for ${variantName} (will fall back): ${detail}${
        stderrTail ? ` | ffmpeg stderr (tail): ${stderrTail}` : ''
      }`
    );
    return null;
  }
};

/**
 * Génère les versions downscalées pour une vidéo
 */
export const generateAlternativeQualitiesBackground = async (
  versionId: string,
  videoUrl: string,
  metadata: VideoMetadata,
  onProgress?: (quality: string, url: string) => void
): Promise<Record<string, string>> => {
  const alternatives: Record<string, string> = {};

  try {
    const availableQualities = getAvailableQualities(metadata.quality);

    for (const quality of availableQualities) {
      try {
        const qualityUrl = await downscaleAndUploadVideo(videoUrl, quality, metadata);

        alternatives[quality] = qualityUrl;

        if (onProgress) {
          onProgress(quality, qualityUrl);
        }
      } catch (error) {
        console.warn(`Failed to generate ${quality} version:`, error);
        // Continue with next quality even if one fails
      }
    }
  } catch (error) {
    console.error('Error generating alternative qualities:', error);
  }

  return alternatives;
};
