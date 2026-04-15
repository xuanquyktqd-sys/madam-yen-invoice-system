/**
 * API Route: POST /api/setup
 * Creates the database schema in Supabase via SQL.
 * Run once to bootstrap the project.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const SCHEMA_SQL = `
-- invoices master table (matches invoice-sample.json structure)
CREATE TABLE IF NOT EXISTS invoices (
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
);

-- invoice_items detail table
CREATE TABLE IF NOT EXISTS invoice_items (
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
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor_name);
CREATE INDEX IF NOT EXISTS idx_invoices_date   ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_items_invoice   ON invoice_items(invoice_id);
`;

export async function POST() {
  try {
    const { error } = await supabaseAdmin.rpc('exec_sql', { sql: SCHEMA_SQL });

    // Try direct SQL if RPC not available
    if (error) {
      // Use pg directly via service role
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        },
        body: JSON.stringify({ sql: SCHEMA_SQL }),
      });

      if (!resp.ok) {
        return NextResponse.json({
          error: 'Could not run schema via RPC. Please run the SQL manually in Supabase SQL Editor.',
          sql: SCHEMA_SQL,
        }, { status: 200 }); // 200 so you can copy the SQL
      }
    }

    return NextResponse.json({ success: true, message: 'Schema created successfully.' });
  } catch (err) {
    return NextResponse.json({
      message: 'Please run this SQL manually in Supabase SQL Editor:',
      sql: SCHEMA_SQL,
    }, { status: 200 });
  }
}
