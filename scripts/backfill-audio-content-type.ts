/**
 * Fix Content-Type on audio voice notes already uploaded to GCS.
 *
 * Before this patch, iOS voice notes (`.mp4`, AAC) were uploaded via
 * uploadDocumentToGCS which set Content-Type to `application/octet-stream`
 * for unknown extensions. Desktop browsers refuse to play them as audio.
 *
 * This script scans every Feedback.audioUrl in the DB and, for each file
 * still stored in GCS with the wrong Content-Type, patches it to the
 * correct audio/* type based on the file extension.
 *
 * Usage:
 *   npx ts-node scripts/backfill-audio-content-type.ts
 *   npx ts-node scripts/backfill-audio-content-type.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';
import { Storage } from '@google-cloud/storage';
import * as path from 'path';

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'toftal-clip-media';
const isDryRun = process.argv.includes('--dry-run');

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

const prisma = new PrismaClient();
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

async function main() {
  console.log(`🔎 Backfill audio Content-Type — bucket=${BUCKET_NAME} dry-run=${isDryRun}`);

  const feedbacks = await prisma.feedback.findMany({
    where: { type: 'AUDIO', audioUrl: { not: null } },
    select: { id: true, audioUrl: true },
  });

  console.log(`📊 ${feedbacks.length} audio feedback(s) found`);

  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (const f of feedbacks) {
    if (!f.audioUrl) continue;
    // Extract the GCS object path from the URL:
    // https://storage.googleapis.com/<bucket>/<objectPath>
    const match = f.audioUrl.match(/storage\.googleapis\.com\/[^/]+\/(.+)$/);
    if (!match) {
      console.log(`   · feedback ${f.id}: non-GCS URL, skipped`);
      skipped++;
      continue;
    }
    const objectPath = decodeURIComponent(match[1]);
    const ext = path.extname(objectPath).toLowerCase();
    const targetMime = MIME_BY_EXT[ext] || 'audio/mp4';

    const file = bucket.file(objectPath);
    let current: string | undefined;
    try {
      const [md] = await file.getMetadata();
      current = md.contentType;
    } catch (err) {
      console.log(`   · feedback ${f.id}: object missing (${objectPath})`);
      skipped++;
      continue;
    }

    if (current === targetMime) {
      skipped++;
      continue;
    }

    if (isDryRun) {
      console.log(`   · [dry-run] ${objectPath}: ${current || '(none)'} → ${targetMime}`);
      continue;
    }

    try {
      await file.setMetadata({ contentType: targetMime });
      fixed++;
      if (fixed % 10 === 0) console.log(`   · ${fixed} fixed so far…`);
    } catch (err) {
      console.warn(`   · FAILED ${objectPath}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n🏁 Done. ${fixed} fixed, ${skipped} already correct / skipped, ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error('❌ Backfill crashed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
