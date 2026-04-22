/**
 * Backfill Version.metadata (duration, width, height, fps, quality) for videos
 * uploaded before the extractVideoMetadata feature existed.
 *
 * Usage:
 *   npx ts-node scripts/backfill-metadata.ts
 *   npx ts-node scripts/backfill-metadata.ts --dry-run
 *   npx ts-node scripts/backfill-metadata.ts --limit=10
 *   npx ts-node scripts/backfill-metadata.ts --force     (re-extract even if metadata exists)
 *
 * Idempotent: skips versions that already have metadata unless --force is set.
 */

import { PrismaClient } from '@prisma/client';
import { extractVideoMetadata } from '../src/services/VideoMetadataService';

const prisma = new PrismaClient();

const parseArg = (name: string): string | undefined => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? raw.split('=')[1] : undefined;
};

const isDryRun = process.argv.includes('--dry-run');
const isForce = process.argv.includes('--force');
const limitArg = parseArg('limit');
const limit = limitArg ? Math.max(1, parseInt(limitArg, 10)) : undefined;

async function main() {
  console.log(`🔎 Backfill metadata — dry-run=${isDryRun} force=${isForce} limit=${limit ?? 'none'}`);

  // Prisma's { equals: null } filter on Json fields is unreliable across
  // versions — use raw SQL to find rows where metadata is NULL or lacks a
  // numeric `duration` key. This is the semantic we actually care about.
  const whereClause = isForce
    ? `video_url <> ''`
    : `video_url <> '' AND (metadata IS NULL OR NOT (metadata ? 'duration') OR (metadata->>'duration') IS NULL)`;
  const limitClause = limit ? `LIMIT ${limit}` : '';
  const rawRows = await prisma.$queryRawUnsafe<
    Array<{ id: string; video_url: string; version_number: number }>
  >(
    `SELECT id, video_url, version_number FROM versions WHERE ${whereClause} ORDER BY created_at ASC ${limitClause}`
  );

  const versions = rawRows.map((r) => ({
    id: r.id,
    videoUrl: r.video_url,
    versionNumber: r.version_number,
  }));

  console.log(`📊 ${versions.length} version(s) ${isForce ? 'to re-extract' : 'without metadata'}`);

  if (versions.length === 0) {
    console.log('✅ Nothing to do.');
    return;
  }

  let success = 0;
  let failed = 0;

  for (const v of versions) {
    const label = `v${v.versionNumber} (${v.id})`;
    if (isDryRun) {
      console.log(`   · [dry-run] would extract metadata for ${label}`);
      continue;
    }

    process.stdout.write(`   · ${label} … `);
    try {
      const metadata = await extractVideoMetadata(v.videoUrl);
      await prisma.version.update({
        where: { id: v.id },
        data: { metadata: metadata as any },
      });
      console.log(`ok → ${metadata.duration}s ${metadata.width}x${metadata.height} ${metadata.quality}`);
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
