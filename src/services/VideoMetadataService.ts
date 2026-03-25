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

    // Commander FFmpeg pour downscaler
    const ffmpegCommand = `ffmpeg -i "${videoUrl}" -vf "scale=${targetRes.width}:${targetRes.height}" -b:v ${targetRes.bitrate} -preset medium "${tempOutputFile}" -y`;

    console.log(`🎬 Downscaling video to ${targetQuality}...`);
    await execAsync(ffmpegCommand, { timeout: 600000 }); // 10 minutes timeout

    // Vérifier que le fichier existe
    if (!fs.existsSync(tempOutputFile)) {
      throw new Error('Output file not created');
    }

    // Upload vers GCS
    console.log(`📤 Uploading ${targetQuality} version to GCS...`);
    const gcsResult = await uploadVideoToGCS(tempOutputFile, `video_${targetQuality}_${Date.now()}.mp4`);

    // Nettoyer le fichier temporaire
    if (fs.existsSync(tempOutputFile)) {
      fs.unlinkSync(tempOutputFile);
    }

    console.log(`✅ ${targetQuality} version uploaded: ${gcsResult.url}`);
    return gcsResult.url;
  } catch (error) {
    console.error(`Error downscaling to ${targetQuality}:`, error);
    throw new Error(`Erreur lors du downscaling vers ${targetQuality}`);
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
