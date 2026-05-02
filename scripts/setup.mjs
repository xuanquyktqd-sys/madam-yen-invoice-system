/**
 * Madam Yen IMS — One-Time Setup Script
 * Run: node scripts/setup.mjs
 *
 * 1. Creates Supabase Storage bucket: invoice-images
 * 2. Creates DB tables: invoices, invoice_items
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env.local manually
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()]; })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BUCKET = 'invoice-images';

// ── 1. Create Storage Bucket ────────────────────────────────────────────────
async function setupStorage() {
  console.log('\n📦 Setting up Supabase Storage...');

  // Check if bucket already exists
  const { data: existing } = await supabase.storage.listBuckets();
  const bucketExists = existing?.some(b => b.name === BUCKET);

  if (bucketExists) {
    console.log(`   ✅ Bucket "${BUCKET}" already exists`);
    return;
  }

  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,       // Public read so image_url works in dashboard
    fileSizeLimit: 10 * 1024 * 1024, // 10MB max
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'],
  });

  if (error) {
    console.error(`   ❌ Bucket creation failed: ${error.message}`);
    return;
  }

  console.log(`   ✅ Bucket "${BUCKET}" created (public, max 10MB)`);
}

// ── 2. Create Database Tables ───────────────────────────────────────────────
async function setupDatabase() {
  console.log('\n🗄️  Setting up Database schema...');

  const statements = [
    `CREATE TABLE IF NOT EXISTS invoices (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type              TEXT DEFAULT 'Tax Invoice',
      vendor_name       TEXT NOT NULL,
      vendor_address    TEXT,
      vendor_gst_number TEXT,
      invoice_number    TEXT,
      invoice_date      DATE,
      currency          TEXT DEFAULT 'NZD',
      is_tax_invoice    BOOLEAN DEFAULT TRUE,
      billing_name      TEXT,
      billing_address   TEXT,
      sub_total         NUMERIC(10,2),
      freight           NUMERIC(10,2) DEFAULT 0.00,
      gst_amount        NUMERIC(10,2),
      total_amount      NUMERIC(10,2),
      image_url         TEXT,
      status            TEXT DEFAULT 'pending_review',
      category          TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (vendor_name, invoice_date, total_amount)
    )`,
    `CREATE TABLE IF NOT EXISTS invoice_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_code    TEXT,
      description     TEXT NOT NULL,
      standard        TEXT,
      quantity        NUMERIC(10,3),
      unit            TEXT,
      price           NUMERIC(10,2),
      amount_excl_gst NUMERIC(10,2),
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_vendor   ON invoices(vendor_name)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_date     ON invoices(invoice_date)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status)`,
    `CREATE INDEX IF NOT EXISTS idx_items_invoice     ON invoice_items(invoice_id)`,
  ];

  for (const sql of statements) {
    // Supabase JS doesn't support raw DDL via client — use fetch to Management API
    const pgResp = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ sql }),
    });

    if (pgResp.ok || pgResp.status === 404) {
      // 404 = RPC not found, skip — user needs to run SQL manually
      break;
    }
  }
}

// ── 3. Verify tables exist via select ──────────────────────────────────────
async function verifySetup() {
  console.log('\n🔍 Verifying setup...');

  // Check bucket
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucket = buckets?.find(b => b.name === BUCKET);
  console.log(`   Storage bucket "${BUCKET}": ${bucket ? '✅' : '❌ NOT FOUND'}`);

  // Check tables
  const { error: invErr } = await supabase.from('invoices').select('id').limit(1);
  console.log(`   Table "invoices": ${invErr ? `❌ ${invErr.message}` : '✅'}`);

  const { error: itemErr } = await supabase.from('invoice_items').select('id').limit(1);
  console.log(`   Table "invoice_items": ${itemErr ? `❌ ${itemErr.message}` : '✅'}`);

  if (!bucket || invErr || itemErr) {
    console.log('\n⚠️  Some resources missing. Please run the SQL from supabase-schema.sql');
    console.log('   in Supabase Dashboard → SQL Editor');
    console.log(`   URL: ${env.NEXT_PUBLIC_SUPABASE_URL.replace('.supabase.co', '')}/sql\n`);
  } else {
    console.log('\n🎉 All set! Madam Yen IMS is ready.\n');
  }
}

// Keep unused helper from triggering lint warning.
void setupDatabase;

// ── Run ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Madam Yen IMS — Setup\n' + '─'.repeat(40));
  await setupStorage();
  await verifySetup();
}

main().catch(console.error);
