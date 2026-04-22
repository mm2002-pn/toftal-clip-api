/**
 * Backfill Version.thumbnailUrl for videos uploaded before the thumbnail
 * feature existed.
 *
 * Usage (locally, via ts-node):
 *   npx ts-node scripts/backfill-thumbnails.ts
 *   npx ts-node scripts/backfill-thumbnails.ts --dry-run
 *   npx ts-node scripts/backfill-thumbnails.ts --limit=20
 *   npx ts-node scripts/backfill-thumbnails.ts --id=<versionId>  (single version)
 *
 * Inside Cloud Run / the staging container (ffmpeg already installed):
 *   node dist/scripts/backfill-thumbnails.js
 *
 * Behavior:
 *   - Selects Versions where videoUrl IS NOT NULL AND thumbnailUrl IS NULL.
 *   - Processes them one by one to avoid saturating ffmpeg / GCS.
 *   - On success, updates Version.thumbnailUrl in place.
 *   - On failure for one row, logs and continues with the next.
 *   - Safe to re-run: already-thumbnailed versions are skipped automatically.
 */

import { PrismaClient } from '@prisma/client';
import { generateVideoThumbnail } from '../src/services/VideoThumbnailService';

const prisma = new PrismaClient();

const parseArg = (name: string): string | undefined => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? raw.split('=')[1] : undefined;
};

const isDryRun = process.argv.includes('--dry-run');
const limitArg = parseArg('limit');
const idArg = parseArg('id');
const limit = limitArg ? Math.max(1, parseInt(limitArg, 10)) : undefined;

async function main() {
  console.log(`🔎 Backfill thumbnails — dry-run=${isDryRun} limit=${limit ?? 'none'} id=${idArg ?? 'none'}`);

  const versions = await prisma.version.findMany({
    where: idArg
      ? { id: idArg }
      : {
          thumbnailUrl: null,
          videoUrl: { not: '' },
        },
    select: { id: true, videoUrl: true, versionNumber: true, deliverableId: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  console.log(`📊 ${versions.length} version(s) without a thumbnail`);

  if (versions.length === 0) {
    console.log('✅ Nothing to do.');
    return;
  }

  let success = 0;
  let failed = 0;

  for (const v of versions) {
    const label = `v${v.versionNumber} (${v.id})`;
    if (isDryRun) {
      console.log(`   · [dry-run] would generate thumbnail for ${label} → ${v.videoUrl}`);
      continue;
    }

    process.stdout.write(`   · ${label} … `);
    try {
      const thumbnailUrl = await generateVideoThumbnail(v.videoUrl);
      if (!thumbnailUrl) {
        console.log('skipped (ffmpeg/upload failed)');
        failed++;
        continue;
      }
      await prisma.version.update({
        where: { id: v.id },
        data: { thumbnailUrl },
      });
      console.log(`ok → ${thumbnailUrl}`);
      success++;
    } catch (err) {
      console.log(`error: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n🏁 Done. ${success} success, ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error('❌ Backfill crashed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
