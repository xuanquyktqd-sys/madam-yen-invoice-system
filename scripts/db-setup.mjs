/**
 * DB Schema Setup via direct PostgreSQL connection
 * Run: node scripts/db-setup.mjs
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()]; })
);

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log('🗄️  Connecting to Supabase PostgreSQL...');
  await client.connect();
  console.log('   ✅ Connected\n');

  const statements = [
    {
      name: 'CREATE TABLE invoices',
      sql: `CREATE TABLE IF NOT EXISTS invoices (
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
    },
    {
      name: 'CREATE TABLE invoice_items',
      sql: `CREATE TABLE IF NOT EXISTS invoice_items (
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
    },
    { name: 'INDEX: vendor',   sql: `CREATE INDEX IF NOT EXISTS idx_invoices_vendor   ON invoices(vendor_name)` },
    { name: 'INDEX: date',     sql: `CREATE INDEX IF NOT EXISTS idx_invoices_date     ON invoices(invoice_date)` },
    { name: 'INDEX: status',   sql: `CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status)` },
    { name: 'INDEX: items',    sql: `CREATE INDEX IF NOT EXISTS idx_items_invoice     ON invoice_items(invoice_id)` },
  ];

  for (const { name, sql } of statements) {
    try {
      await client.query(sql);
      console.log(`   ✅ ${name}`);
    } catch (err) {
      console.error(`   ❌ ${name}: ${err.message}`);
    }
  }

  // Verify
  console.log('\n🔍 Verifying tables...');
  const res = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('invoices', 'invoice_items')
    ORDER BY table_name
  `);
  res.rows.forEach(r => console.log(`   ✅ Table exists: ${r.table_name}`));

  await client.end();
  console.log('\n🎉 Database setup complete!\n');
}

run().catch(async (err) => {
  console.error('❌ Fatal:', err.message);
  await client.end().catch(() => {});
  process.exit(1);
});
