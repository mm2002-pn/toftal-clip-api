/**
 * Backfill `fileSize` on Version + MediaResource rows by calling GCS
 * `getMetadata()` for each file URL and storing the byte count.
 *
 * Only touches rows where `fileSize IS NULL`. Safe to re-run.
 *
 * Usage:
 *   npm run backfill:file-sizes
 *   npm run backfill:file-sizes -- --dry-run
 *   npm run backfill:file-sizes -- --limit=100
 */

import { Storage } from '@google-cloud/storage';
import { PrismaClient } from '@prisma/client';

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'toftal-clip-media';
const PUBLIC_PREFIX = `https://storage.googleapis.com/${BUCKET_NAME}/`;

const isDryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

const prisma = new PrismaClient();
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

/**
 * Extract the GCS object name from a public URL.
 * Returns null if the URL isn't in our bucket (e.g. external URL, Firebase, …).
 */
const extractGcsPath = (url: string | null | undefined): string | null => {
  if (!url) return null;
  if (url.startsWith(PUBLIC_PREFIX)) {
    return decodeURIComponent(url.slice(PUBLIC_PREFIX.length).split('?')[0]);
  }
  return null;
};

const fetchSize = async (gcsPath: string): Promise<bigint | null> => {
  try {
    const [md] = await bucket.file(gcsPath).getMetadata();
    const size = typeof md.size === 'string' ? BigInt(md.size) : BigInt(md.size ?? 0);
    return size > BigInt(0) ? size : null;
  } catch {
    return null;
  }
};

async function backfillVersions(): Promise<{ scanned: number; updated: number; skipped: number; failed: number }> {
  const rows = await prisma.version.findMany({
    where: { fileSize: null },
    select: { id: true, videoUrl: true },
    ...(limit ? { take: limit } : {}),
  });

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const gcsPath = extractGcsPath(row.videoUrl);
    if (!gcsPath) {
      skipped++;
      continue;
    }

    const size = await fetchSize(gcsPath);
    if (size === null) {
      failed++;
      continue;
    }

    if (isDryRun) {
      console.log(`   · [dry-run] version ${row.id} → ${size} bytes`);
    } else {
      await prisma.version.update({
        where: { id: row.id },
        data: { fileSize: size },
      });
    }
    updated++;
    if (updated % 10 === 0) console.log(`   · ${updated} versions updated…`);
  }

  return { scanned: rows.length, updated, skipped, failed };
}

async function backfillMediaResources(): Promise<{ scanned: number; updated: number; skipped: number; failed: number }> {
  const rows = await prisma.mediaResource.findMany({
    where: { fileSize: null, type: { not: 'FOLDER' } },
    select: { id: true, url: true },
    ...(limit ? { take: limit } : {}),
  });

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const gcsPath = extractGcsPath(row.url);
    if (!gcsPath) {
      skipped++;
      continue;
    }

    const size = await fetchSize(gcsPath);
    if (size === null) {
      failed++;
      continue;
    }

    if (isDryRun) {
      console.log(`   · [dry-run] media ${row.id} → ${size} bytes`);
    } else {
      await prisma.mediaResource.update({
        where: { id: row.id },
        data: { fileSize: size },
      });
    }
    updated++;
    if (updated % 10 === 0) console.log(`   · ${updated} media resources updated…`);
  }

  return { scanned: rows.length, updated, skipped, failed };
}

async function main() {
  console.log(`🔎 Backfill file sizes — bucket=${BUCKET_NAME} dry-run=${isDryRun}${limit ? ` limit=${limit}` : ''}`);

  console.log('\n📹 Versions…');
  const v = await backfillVersions();
  console.log(`   → scanned=${v.scanned} updated=${v.updated} skipped=${v.skipped} failed=${v.failed}`);

  console.log('\n📁 Media resources…');
  const m = await backfillMediaResources();
  console.log(`   → scanned=${m.scanned} updated=${m.updated} skipped=${m.skipped} failed=${m.failed}`);

  console.log('\n✅ Done.');
  console.log(`   Total updated: ${v.updated + m.updated}`);
  console.log(`   Skipped (non-GCS URL): ${v.skipped + m.skipped}`);
  console.log(`   Failed (GCS lookup error / file missing): ${v.failed + m.failed}`);
}

main()
  .catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
