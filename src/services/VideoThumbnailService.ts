/**
 * Extrait une image preview d'une video et l'upload sur GCS.
 *
 * Utilise ffmpeg (deja present pour extractVideoMetadata) pour prendre la frame
 * a ~1s (evite les frames noires au tout debut) et la sauver en JPEG ~640px
 * de large, qualite ~75. Fichier resultant ~20-60KB.
 *
 * L'appel est concu pour etre execute en fire-and-forget apres la creation
 * d'une version : il ne doit pas bloquer la reponse HTTP.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { uploadImageToGCS } from '../config/gcs';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

/**
 * Genere un thumbnail JPEG depuis une URL video, l'uploade sur GCS et retourne
 * l'URL publique. Ne lance pas d'erreur cote appelant : en cas d'echec, log
 * et retourne null pour que le fallback cote client prenne le relais.
 */
export const generateVideoThumbnail = async (videoUrl: string): Promise<string | null> => {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `thumb-${uuidv4()}.jpg`);

  try {
    // -ss avant -i = seek rapide (input seek). On prend la frame a 1s pour
    // eviter les frames noires du tout debut. -vframes 1 = une seule frame.
    // scale=640:-2 = largeur 640, hauteur auto (divisible par 2 pour h264 compat).
    // -q:v 3 = qualite JPEG elevee (~1-31, 3 est visuellement presque identique a la source).
    const cmd = `ffmpeg -y -ss 00:00:01 -i "${videoUrl}" -vframes 1 -vf "scale=640:-2" -q:v 3 "${tmpFile}"`;
    await execAsync(cmd, { timeout: 30_000 });

    // Verifier que le fichier a bien ete cree
    const stats = await fs.stat(tmpFile);
    if (stats.size === 0) {
      throw new Error('Generated thumbnail is empty');
    }

    // Upload vers GCS dans le dossier thumbnails/
    const { publicUrl } = await uploadImageToGCS(tmpFile, `thumb-${uuidv4()}.jpg`);
    return publicUrl;
  } catch (error) {
    logger.warn(`Thumbnail generation failed for ${videoUrl}: ${(error as Error).message}`);
    return null;
  } finally {
    // Nettoyer le fichier temporaire dans tous les cas
    fs.unlink(tmpFile).catch(() => {
      /* ignore */
    });
  }
};
