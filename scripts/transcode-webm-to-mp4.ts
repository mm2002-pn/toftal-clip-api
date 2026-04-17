/**
 * Script to transcode all existing WebM audio files to MP4/AAC
 * for iOS Safari compatibility.
 *
 * Usage:
 *   npx ts-node scripts/transcode-webm-to-mp4.ts
 *   npx ts-node scripts/transcode-webm-to-mp4.ts --dry-run  (preview only)
 */

import { Storage } from '@google-cloud/storage';
import { PrismaClient } from '@prisma/client';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import os from 'os';

const prisma = new PrismaClient();
const storage = new Storage();
const BUCKET_NAME = 'toftal-clip-media';
const bucket = storage.bucket(BUCKET_NAME);

const isDryRun = process.argv.includes('--dry-run');

interface TranscodeResult {
  original: string;
  transcoded: string;
  success: boolean;
  error?: string;
}

/**
 * Transcode audio to MP4/AAC format
 */
const transcodeToMp4 = (inputPath: string, outputPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('aac')
      .audioBitrate('128k')
      .audioChannels(2)
      .audioFrequency(44100)
      .format('mp4')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
};

/**
 * Download file from GCS to local temp directory
 */
const downloadFromGCS = async (fileName: string, localPath: string): Promise<void> => {
  await bucket.file(fileName).download({ destination: localPath });
};

/**
 * Upload file to GCS
 */
const uploadToGCS = async (localPath: string, destFileName: string): Promise<string> => {
  await bucket.upload(localPath, {
    destination: destFileName,
    metadata: {
      contentType: 'audio/mp4',
    },
  });
  return `https://storage.googleapis.com/${BUCKET_NAME}/${destFileName}`;
};

/**
 * Find all WebM audio files in GCS bucket
 */
const findWebmFiles = async (): Promise<string[]> => {
  const [files] = await bucket.getFiles({ prefix: 'documents/' });

  const webmFiles = files
    .filter(file => file.name.endsWith('.webm'))
    .map(file => file.name);

  console.log(`Found ${webmFiles.length} WebM files in GCS`);
  return webmFiles;
};

/**
 * Find all database records with WebM audio URLs
 */
const findWebmInDatabase = async (): Promise<{ table: string; id: string; field: string; url: string }[]> => {
  const results: { table: string; id: string; field: string; url: string }[] = [];

  // Check Feedback table for audioUrl
  const feedbacks = await prisma.feedback.findMany({
    where: {
      audioUrl: {
        contains: '.webm',
      },
    },
    select: {
      id: true,
      audioUrl: true,
    },
  });

  for (const f of feedbacks) {
    if (f.audioUrl) {
      results.push({ table: 'Feedback', id: f.id, field: 'audioUrl', url: f.audioUrl });
    }
  }

  console.log(`Found ${results.length} WebM references in database`);
  return results;
};

/**
 * Update database record with new URL
 */
const updateDatabaseUrl = async (table: string, id: string, field: string, newUrl: string): Promise<void> => {
  if (table === 'Feedback' && field === 'audioUrl') {
    await prisma.feedback.update({
      where: { id },
      data: { audioUrl: newUrl },
    });
  }
};

/**
 * Main migration function
 */
const migrateWebmToMp4 = async (): Promise<void> => {
  console.log('========================================');
  console.log('  WebM to MP4 Migration Script');
  console.log('========================================');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log('');

  const results: TranscodeResult[] = [];
  const tempDir = path.join(os.tmpdir(), 'webm-migration');

  // Create temp directory
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // Find all WebM files in database
    const dbRecords = await findWebmInDatabase();

    if (dbRecords.length === 0) {
      console.log('No WebM files found in database. Nothing to migrate.');
      return;
    }

    console.log('');
    console.log('Starting migration...');
    console.log('');

    for (let i = 0; i < dbRecords.length; i++) {
      const record = dbRecords[i];
      const progress = `[${i + 1}/${dbRecords.length}]`;

      // Extract GCS file path from URL
      const urlMatch = record.url.match(/storage\.googleapis\.com\/[^/]+\/(.+)/);
      if (!urlMatch) {
        console.log(`${progress} ⚠️  Invalid URL format: ${record.url}`);
        results.push({ original: record.url, transcoded: '', success: false, error: 'Invalid URL' });
        continue;
      }

      const gcsFilePath = urlMatch[1];
      const baseName = path.basename(gcsFilePath, '.webm');
      const mp4FileName = `${path.dirname(gcsFilePath)}/${baseName}.mp4`;
      const localWebm = path.join(tempDir, `${baseName}.webm`);
      const localMp4 = path.join(tempDir, `${baseName}.mp4`);

      console.log(`${progress} Processing: ${baseName}.webm`);

      if (isDryRun) {
        console.log(`       → Would transcode to: ${mp4FileName}`);
        console.log(`       → Would update ${record.table}.${record.id}`);
        results.push({ original: record.url, transcoded: mp4FileName, success: true });
        continue;
      }

      try {
        // Download from GCS
        console.log(`       ↓ Downloading...`);
        await downloadFromGCS(gcsFilePath, localWebm);

        // Transcode
        console.log(`       ⚙ Transcoding...`);
        await transcodeToMp4(localWebm, localMp4);

        // Upload transcoded file
        console.log(`       ↑ Uploading MP4...`);
        const newUrl = await uploadToGCS(localMp4, mp4FileName);

        // Update database
        console.log(`       📝 Updating database...`);
        await updateDatabaseUrl(record.table, record.id, record.field, newUrl);

        console.log(`       ✅ Done!`);
        results.push({ original: record.url, transcoded: newUrl, success: true });

        // Clean up local files
        if (fs.existsSync(localWebm)) fs.unlinkSync(localWebm);
        if (fs.existsSync(localMp4)) fs.unlinkSync(localMp4);

      } catch (error: any) {
        console.log(`       ❌ Error: ${error.message}`);
        results.push({ original: record.url, transcoded: '', success: false, error: error.message });

        // Clean up on error
        if (fs.existsSync(localWebm)) fs.unlinkSync(localWebm);
        if (fs.existsSync(localMp4)) fs.unlinkSync(localMp4);
      }
    }

    // Summary
    console.log('');
    console.log('========================================');
    console.log('  Migration Summary');
    console.log('========================================');
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total: ${results.length}`);

    if (failed > 0) {
      console.log('');
      console.log('Failed files:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.original}: ${r.error}`);
      });
    }

  } finally {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    await prisma.$disconnect();
  }
};

// Run migration
migrateWebmToMp4()
  .then(() => {
    console.log('');
    console.log('Migration completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
