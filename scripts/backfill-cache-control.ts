/**
 * Backfill `Cache-Control: public, max-age=31536000, immutable` on every
 * existing file in the GCS bucket.
 *
 * These files are uploaded with UUID paths — their content never changes — so
 * we safely tell browsers and the CDN to cache them for 1 year. Future reads
 * of the same URL will skip revalidation entirely (~200ms saved per request).
 *
 * Usage:
 *   npx ts-node scripts/backfill-cache-control.ts
 *   npx ts-node scripts/backfill-cache-control.ts --dry-run
 *   npx ts-node scripts/backfill-cache-control.ts --prefix=videos/
 *   npx ts-node scripts/backfill-cache-control.ts --prefix=images/
 */

import { Storage } from '@google-cloud/storage';

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'toftal-clip-media';
const TARGET_HEADER = 'public, max-age=31536000, immutable';

const parseArg = (name: string): string | undefined => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? raw.split('=')[1] : undefined;
};

const isDryRun = process.argv.includes('--dry-run');
const prefix = parseArg('prefix') || '';

async function main() {
  console.log(`🔎 Backfill Cache-Control — bucket=${BUCKET_NAME} prefix=${prefix || '(all)'} dry-run=${isDryRun}`);

  const storage = new Storage();
  const bucket = storage.bucket(BUCKET_NAME);

  const [files] = await bucket.getFiles({ prefix });
  console.log(`📊 ${files.length} file(s) found`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const [md] = await file.getMetadata();
    const current = md.cacheControl;
    if (current === TARGET_HEADER) {
      skipped++;
      continue;
    }

    if (isDryRun) {
      console.log(`   · [dry-run] ${file.name} (current="${current || '(none)'}")`);
      continue;
    }

    try {
      await file.setMetadata({ cacheControl: TARGET_HEADER });
      updated++;
      if (updated % 25 === 0) console.log(`   · ${updated} files updated so far…`);
    } catch (err) {
      console.warn(`   · FAILED ${file.name}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n🏁 Done. ${updated} updated, ${skipped} already correct, ${failed} failed.`);
}

main().catch((err) => {
  console.error('❌ Backfill crashed:', err);
  process.exit(1);
});
