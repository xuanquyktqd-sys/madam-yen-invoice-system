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

function tryGetStoragePathFromInvoiceImageRef(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  // Support storing the path directly (recommended for DB, e.g. "2024/09/foo.jpg")
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    return decodeURIComponent(raw.replace(/^\/+/, ''));
  }

  try {
    const url = new URL(raw);
    const publicPrefix = `/storage/v1/object/public/${BUCKET}/`;
    const signedPrefix = `/storage/v1/object/sign/${BUCKET}/`;

    if (url.pathname.startsWith(publicPrefix)) {
      return decodeURIComponent(url.pathname.slice(publicPrefix.length));
    }
    if (url.pathname.startsWith(signedPrefix)) {
      return decodeURIComponent(url.pathname.slice(signedPrefix.length));
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchAllStorageObjects(client) {
  const res = await client.query(
    `SELECT name, updated_at
     FROM storage.objects
     WHERE bucket_id = $1
     ORDER BY name`,
    [BUCKET]
  );
  return res.rows.map((r) => ({
    name: String(r.name),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null,
  }));
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
    const p = tryGetStoragePathFromInvoiceImageRef(r.image_url);
    if (p) referenced.add(p);
  }
  console.log(`📌 Referenced images in DB: ${referenced.size}`);

  console.log('📦 Fetching storage objects from DB...');
  const allObjects = await fetchAllStorageObjects(client);
  console.log(`   Total objects in bucket: ${allObjects.length}`);

  const olderThanMs =
    args.olderThanDays === null ? null : args.olderThanDays * 24 * 60 * 60 * 1000;
  const cutoff = olderThanMs === null ? null : Date.now() - olderThanMs;

  const orphans = [];
  for (const obj of allObjects) {
    if (referenced.has(obj.name)) continue;
    if (cutoff !== null) {
      // When updated_at is missing, treat as eligible (conservative for cleanup).
      if (obj.updatedAt !== null && obj.updatedAt > cutoff) continue;
    }
    orphans.push(obj.name);
  }

  console.log(`🧾 Orphan candidates: ${orphans.length}`);
  if (orphans.length === 0) {
    await client.end();
    console.log('✅ Nothing to delete.');
    return;
  }

  console.log('');
  console.log('Sample (first 20):');
  for (const p of orphans.slice(0, 20)) console.log(` - ${p}`);
  if (orphans.length > 20) console.log(` - ... (${orphans.length - 20} more)`);
  console.log('');

  if (!args.yes) {
    console.log('Dry-run only. Re-run with `--yes` to delete.');
    await client.end();
    return;
  }

  console.log('🗑️  Deleting...');
  let deleted = 0;
  for (const batch of chunk(orphans, 100)) {
    const { error } = await supabaseAdmin.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`Storage remove failed: ${error.message}`);
    deleted += batch.length;
    console.log(`   ✅ Deleted ${deleted}/${orphans.length}`);
  }

  await client.end();
  console.log('🎉 Done.');
}

run().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
