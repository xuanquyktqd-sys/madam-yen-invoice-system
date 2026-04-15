/**
 * Cleanup orphaned invoice images in Supabase Storage.
 *
 * Orphan definition:
 *  - A file exists in bucket `invoice-images`
 *  - BUT no row in `invoices.image_url` references that file
 *
 * Safe by default:
 *  - Dry-run (prints what would be deleted)
 *  - Pass `--yes` to actually delete
 *
 * Usage:
 *   node scripts/cleanup-orphan-images.mjs
 *   node scripts/cleanup-orphan-images.mjs --yes
 *   node scripts/cleanup-orphan-images.mjs --yes --older-than-days=7
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'invoice-images';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const [k, ...v] = l.split('=');
      return [k.trim(), v.join('=').trim()];
    })
);

function parseArgs(argv) {
  const args = { yes: false, olderThanDays: null };
  for (const a of argv) {
    if (a === '--yes') args.yes = true;
    if (a.startsWith('--older-than-days=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n >= 0) args.olderThanDays = n;
    }
  }
  return args;
}

function tryGetStoragePathFromPublicUrl(publicUrl) {
  try {
    const url = new URL(publicUrl);
    const prefix = `/storage/v1/object/public/${BUCKET}/`;
    if (!url.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

async function listAllFiles(storage, prefix = '') {
  const files = [];
  let offset = 0;
  const limit = 1000;

  // Supabase Storage list is paginated with offset/limit.
  while (true) {
    const { data, error } = await storage.from(BUCKET).list(prefix, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`Storage list failed at "${prefix}": ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      // Heuristic: folders have null metadata
      if (!entry.metadata) {
        const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        const nested = await listAllFiles(storage, nextPrefix);
        files.push(...nested);
      } else {
        files.push(prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    }

    if (data.length < limit) break;
    offset += limit;
  }

  return files;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = env.DATABASE_URL;

  if (!supabaseUrl || !serviceKey || !databaseUrl) {
    throw new Error('Missing env vars in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL');
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'public' },
  });

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  console.log('🧹 Orphan image cleanup (Supabase Storage)');
  console.log(`   Bucket: ${BUCKET}`);
  console.log(`   Mode: ${args.yes ? 'DELETE' : 'DRY-RUN'}`);
  if (args.olderThanDays !== null) console.log(`   Filter: older than ${args.olderThanDays} days`);
  console.log('');

  await client.connect();

  const refRes = await client.query(
    `SELECT image_url FROM invoices WHERE image_url IS NOT NULL AND image_url <> ''`
  );

  const referenced = new Set();
  for (const r of refRes.rows) {
    const p = tryGetStoragePathFromPublicUrl(String(r.image_url));
    if (p) referenced.add(p);
  }
  console.log(`📌 Referenced images in DB: ${referenced.size}`);

  console.log('📦 Listing storage files...');
  const allFiles = await listAllFiles(supabaseAdmin.storage);
  console.log(`   Total files in bucket: ${allFiles.length}`);

  const olderThanMs =
    args.olderThanDays === null ? null : args.olderThanDays * 24 * 60 * 60 * 1000;
  const cutoff = olderThanMs === null ? null : Date.now() - olderThanMs;

  const orphans = [];
  for (const path of allFiles) {
    if (referenced.has(path)) continue;
    orphans.push(path);
  }

  console.log(`🧾 Orphan candidates: ${orphans.length}`);
  if (orphans.length === 0) {
    await client.end();
    console.log('✅ Nothing to delete.');
    return;
  }

  // Optionally filter by age (requires a per-file HEAD; keep simple by skipping unless requested)
  let finalOrphans = orphans;
  if (cutoff !== null) {
    console.log('⏳ Checking file ages (this may take a while)...');
    const keep = [];
    for (const p of orphans) {
      // We can’t read storage.objects directly (protected), so we rely on Storage API metadata
      const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(
        p.includes('/') ? p.split('/').slice(0, -1).join('/') : '',
        { limit: 2000 }
      );
      if (error) continue;
      const name = p.split('/').pop();
      const entry = (data ?? []).find((x) => x.name === name);
      const updatedAt = entry?.updated_at ? new Date(entry.updated_at).getTime() : null;
      if (updatedAt !== null && updatedAt <= cutoff) keep.push(p);
    }
    finalOrphans = keep;
    console.log(`🧾 Orphans after age filter: ${finalOrphans.length}`);
  }

  console.log('');
  console.log('Sample (first 20):');
  for (const p of finalOrphans.slice(0, 20)) console.log(` - ${p}`);
  if (finalOrphans.length > 20) console.log(` - ... (${finalOrphans.length - 20} more)`);
  console.log('');

  if (!args.yes) {
    console.log('Dry-run only. Re-run with `--yes` to delete.');
    await client.end();
    return;
  }

  console.log('🗑️  Deleting...');
  let deleted = 0;
  for (const batch of chunk(finalOrphans, 100)) {
    const { error } = await supabaseAdmin.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`Storage remove failed: ${error.message}`);
    deleted += batch.length;
    console.log(`   ✅ Deleted ${deleted}/${finalOrphans.length}`);
  }

  await client.end();
  console.log('🎉 Done.');
}

run().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});

