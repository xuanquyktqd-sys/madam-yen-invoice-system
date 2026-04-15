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
    { name: 'ALTER invoices ADD parent_invoice_id', sql: `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS parent_invoice_id UUID` },
    {
      name: 'ADD FK invoices.parent_invoice_id',
      sql: `DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_parent_invoice_id_fkey') THEN
          ALTER TABLE invoices
            ADD CONSTRAINT invoices_parent_invoice_id_fkey
            FOREIGN KEY (parent_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
        END IF;
      END $$`,
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
    { name: 'INDEX: parent',   sql: `CREATE INDEX IF NOT EXISTS idx_invoices_parent_invoice_id ON invoices(parent_invoice_id)` },
    { name: 'INDEX: items',    sql: `CREATE INDEX IF NOT EXISTS idx_items_invoice     ON invoice_items(invoice_id)` },

    // ── Phase 1: Catalog normalization (additive) ─────────────────────────
    {
      name: 'CREATE TABLE vendors',
      sql: `CREATE TABLE IF NOT EXISTS vendors (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT NOT NULL UNIQUE,
        gst_number TEXT,
        address    TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    },
    {
      name: 'CREATE TABLE units',
      sql: `CREATE TABLE IF NOT EXISTS units (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code       TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    },
    {
      name: 'CREATE TABLE standards',
      sql: `CREATE TABLE IF NOT EXISTS standards (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        value      TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    },
    {
      name: 'CREATE TABLE restaurant_products',
      sql: `CREATE TABLE IF NOT EXISTS restaurant_products (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_product_id TEXT NOT NULL UNIQUE,
        vendor_id             UUID NOT NULL REFERENCES vendors(id),
        vendor_product_code   TEXT,
        name                  TEXT NOT NULL,
        unit_id               UUID REFERENCES units(id),
        standard_id           UUID REFERENCES standards(id),
        created_at            TIMESTAMPTZ DEFAULT NOW(),
        updated_at            TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (vendor_id, vendor_product_code)
      )`,
    },
    { name: 'CREATE SEQUENCE restaurant_product_seq', sql: `CREATE SEQUENCE IF NOT EXISTS restaurant_product_seq` },
    { name: 'ALTER invoices ADD vendor_id', sql: `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vendor_id UUID` },
    { name: 'ALTER items ADD product_id', sql: `ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS product_id UUID` },
    { name: 'ALTER items ADD unit_id', sql: `ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit_id UUID` },
    { name: 'ALTER items ADD standard_id', sql: `ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS standard_id UUID` },
    {
      name: 'ADD FK constraints',
      sql: `DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_vendor_id_fkey') THEN
          ALTER TABLE invoices
            ADD CONSTRAINT invoices_vendor_id_fkey
            FOREIGN KEY (vendor_id) REFERENCES vendors(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_product_id_fkey') THEN
          ALTER TABLE invoice_items
            ADD CONSTRAINT invoice_items_product_id_fkey
            FOREIGN KEY (product_id) REFERENCES restaurant_products(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_unit_id_fkey') THEN
          ALTER TABLE invoice_items
            ADD CONSTRAINT invoice_items_unit_id_fkey
            FOREIGN KEY (unit_id) REFERENCES units(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_standard_id_fkey') THEN
          ALTER TABLE invoice_items
            ADD CONSTRAINT invoice_items_standard_id_fkey
            FOREIGN KEY (standard_id) REFERENCES standards(id);
        END IF;
      END $$`,
    },
    {
      name: 'CREATE FUNCTION my_normalize_code',
      sql: `CREATE OR REPLACE FUNCTION my_normalize_code(input TEXT)
      RETURNS TEXT AS $$
        SELECT NULLIF(regexp_replace(upper(trim(coalesce(input, ''))), '[^A-Z0-9]', '', 'g'), '');
      $$ LANGUAGE sql IMMUTABLE`,
    },
    {
      name: 'CREATE FUNCTION my_next_restaurant_product_id',
      sql: `CREATE OR REPLACE FUNCTION my_next_restaurant_product_id()
      RETURNS TEXT AS $$
      DECLARE
        candidate TEXT;
      BEGIN
        LOOP
          candidate := 'MY' || lpad(nextval('restaurant_product_seq')::text, 6, '0');
          EXIT WHEN NOT EXISTS (
            SELECT 1 FROM restaurant_products WHERE restaurant_product_id = candidate
          );
        END LOOP;
        RETURN candidate;
      END;
      $$ LANGUAGE plpgsql`,
    },
    {
      name: 'CREATE FUNCTION trg_invoices_set_vendor_id',
      sql: `CREATE OR REPLACE FUNCTION trg_invoices_set_vendor_id()
      RETURNS trigger AS $$
      DECLARE
        v_id UUID;
        v_name TEXT;
      BEGIN
        v_name := NULLIF(trim(coalesce(NEW.vendor_name, '')), '');
        IF v_name IS NULL THEN
          RETURN NEW;
        END IF;

        INSERT INTO vendors (name, gst_number, address, created_at, updated_at)
        VALUES (v_name, NEW.vendor_gst_number, NEW.vendor_address, NOW(), NOW())
        ON CONFLICT (name) DO UPDATE
          SET gst_number = COALESCE(EXCLUDED.gst_number, vendors.gst_number),
              address    = COALESCE(EXCLUDED.address, vendors.address),
              updated_at = NOW()
        RETURNING id INTO v_id;

        NEW.vendor_id := v_id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`,
    },
    { name: 'DROP TRIGGER invoices_before_ins_upd', sql: `DROP TRIGGER IF EXISTS invoices_before_ins_upd ON invoices` },
    {
      name: 'CREATE TRIGGER invoices_before_ins_upd',
      sql: `CREATE TRIGGER invoices_before_ins_upd
      BEFORE INSERT OR UPDATE ON invoices
      FOR EACH ROW
      EXECUTE FUNCTION trg_invoices_set_vendor_id()`,
    },
    {
      name: 'CREATE FUNCTION trg_invoice_items_set_catalog_ids',
      sql: `CREATE OR REPLACE FUNCTION trg_invoice_items_set_catalog_ids()
      RETURNS trigger AS $$
      DECLARE
        inv_vendor_id UUID;
        inv_vendor_name TEXT;
        inv_vendor_gst TEXT;
        inv_vendor_addr TEXT;
        unit_code TEXT;
        std_val TEXT;
        code_norm TEXT;
        rp_id UUID;
        rp_internal_id TEXT;
      BEGIN
        SELECT vendor_id, vendor_name, vendor_gst_number, vendor_address
          INTO inv_vendor_id, inv_vendor_name, inv_vendor_gst, inv_vendor_addr
        FROM invoices WHERE id = NEW.invoice_id;

        IF inv_vendor_id IS NULL THEN
          inv_vendor_name := NULLIF(trim(coalesce(inv_vendor_name, '')), '');
          IF inv_vendor_name IS NOT NULL THEN
            INSERT INTO vendors (name, gst_number, address, created_at, updated_at)
            VALUES (inv_vendor_name, inv_vendor_gst, inv_vendor_addr, NOW(), NOW())
            ON CONFLICT (name) DO UPDATE
              SET gst_number = COALESCE(EXCLUDED.gst_number, vendors.gst_number),
                  address    = COALESCE(EXCLUDED.address, vendors.address),
                  updated_at = NOW()
            RETURNING id INTO inv_vendor_id;

            UPDATE invoices SET vendor_id = inv_vendor_id WHERE id = NEW.invoice_id;
          END IF;
        END IF;

        IF NEW.unit_id IS NULL THEN
          unit_code := NULLIF(upper(trim(coalesce(NEW.unit, ''))), '');
          IF unit_code IS NOT NULL THEN
            INSERT INTO units (code, created_at)
            VALUES (unit_code, NOW())
            ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
            RETURNING id INTO NEW.unit_id;
          END IF;
        END IF;

        IF NEW.standard_id IS NULL THEN
          std_val := NULLIF(trim(coalesce(NEW.standard, '')), '');
          IF std_val IS NOT NULL THEN
            INSERT INTO standards (value, created_at)
            VALUES (std_val, NOW())
            ON CONFLICT (value) DO UPDATE SET value = EXCLUDED.value
            RETURNING id INTO NEW.standard_id;
          END IF;
        END IF;

        IF NEW.product_id IS NULL AND inv_vendor_id IS NOT NULL THEN
          code_norm := my_normalize_code(NEW.product_code);

          IF code_norm IS NOT NULL THEN
            rp_internal_id := 'MY' || code_norm;
            IF EXISTS (SELECT 1 FROM restaurant_products WHERE restaurant_product_id = rp_internal_id) THEN
              rp_internal_id := my_next_restaurant_product_id();
            END IF;

            INSERT INTO restaurant_products
              (restaurant_product_id, vendor_id, vendor_product_code, name, unit_id, standard_id, created_at, updated_at)
            VALUES
              (rp_internal_id, inv_vendor_id, code_norm, COALESCE(NULLIF(trim(NEW.description), ''), code_norm),
               NEW.unit_id, NEW.standard_id, NOW(), NOW())
            ON CONFLICT (vendor_id, vendor_product_code) DO UPDATE
              SET name       = EXCLUDED.name,
                  unit_id    = COALESCE(restaurant_products.unit_id, EXCLUDED.unit_id),
                  standard_id= COALESCE(restaurant_products.standard_id, EXCLUDED.standard_id),
                  updated_at = NOW()
            RETURNING id INTO rp_id;

            NEW.product_id := rp_id;
          ELSE
            rp_internal_id := my_next_restaurant_product_id();
            INSERT INTO restaurant_products
              (restaurant_product_id, vendor_id, vendor_product_code, name, unit_id, standard_id, created_at, updated_at)
            VALUES
              (rp_internal_id, inv_vendor_id, NULL, COALESCE(NULLIF(trim(NEW.description), ''), rp_internal_id),
               NEW.unit_id, NEW.standard_id, NOW(), NOW())
            RETURNING id INTO NEW.product_id;
          END IF;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`,
    },
    { name: 'DROP TRIGGER invoice_items_before_ins_upd', sql: `DROP TRIGGER IF EXISTS invoice_items_before_ins_upd ON invoice_items` },
    {
      name: 'CREATE TRIGGER invoice_items_before_ins_upd',
      sql: `CREATE TRIGGER invoice_items_before_ins_upd
      BEFORE INSERT OR UPDATE ON invoice_items
      FOR EACH ROW
      EXECUTE FUNCTION trg_invoice_items_set_catalog_ids()`,
    },

    { name: 'INDEX: invoices.vendor_id', sql: `CREATE INDEX IF NOT EXISTS idx_invoices_vendor_id ON invoices(vendor_id)` },
    { name: 'INDEX: items.product_id', sql: `CREATE INDEX IF NOT EXISTS idx_items_product_id ON invoice_items(product_id)` },
    { name: 'INDEX: items.unit_id', sql: `CREATE INDEX IF NOT EXISTS idx_items_unit_id ON invoice_items(unit_id)` },
    { name: 'INDEX: items.standard_id', sql: `CREATE INDEX IF NOT EXISTS idx_items_standard_id ON invoice_items(standard_id)` },

    { name: 'RLS: vendors', sql: `ALTER TABLE vendors ENABLE ROW LEVEL SECURITY` },
    { name: 'RLS: units', sql: `ALTER TABLE units ENABLE ROW LEVEL SECURITY` },
    { name: 'RLS: standards', sql: `ALTER TABLE standards ENABLE ROW LEVEL SECURITY` },
    { name: 'RLS: restaurant_products', sql: `ALTER TABLE restaurant_products ENABLE ROW LEVEL SECURITY` },
    {
      name: 'POLICY: catalog tables',
      sql: `DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='vendors' AND policyname='Service role full access on vendors') THEN
          CREATE POLICY "Service role full access on vendors"
            ON vendors FOR ALL
            USING (true)
            WITH CHECK (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='units' AND policyname='Service role full access on units') THEN
          CREATE POLICY "Service role full access on units"
            ON units FOR ALL
            USING (true)
            WITH CHECK (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='standards' AND policyname='Service role full access on standards') THEN
          CREATE POLICY "Service role full access on standards"
            ON standards FOR ALL
            USING (true)
            WITH CHECK (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='restaurant_products' AND policyname='Service role full access on restaurant_products') THEN
          CREATE POLICY "Service role full access on restaurant_products"
            ON restaurant_products FOR ALL
            USING (true)
            WITH CHECK (true);
        END IF;
      END $$`,
    },
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
