-- ============================================================
-- MADAM YEN IMS — Database Schema Setup
-- Run this in: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. INVOICES (Master table)
CREATE TABLE IF NOT EXISTS invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Invoice metadata (matches invoice-sample.json)
  type              TEXT DEFAULT 'Tax Invoice',
  vendor_name       TEXT NOT NULL,
  vendor_address    TEXT,
  vendor_gst_number TEXT,
  invoice_number    TEXT,
  invoice_date      DATE,
  currency          TEXT DEFAULT 'NZD',
  is_tax_invoice    BOOLEAN DEFAULT TRUE,
  
  -- Billing info
  billing_name      TEXT,
  billing_address   TEXT,
  
  -- Totals
  sub_total         NUMERIC(10,2),
  freight           NUMERIC(10,2) DEFAULT 0.00,
  gst_amount        NUMERIC(10,2),
  total_amount      NUMERIC(10,2),
  
  -- Storage
  image_url         TEXT,
  
  -- Workflow
  status            TEXT DEFAULT 'pending_review', -- pending_review | approved | rejected
  category          TEXT,                          -- Food | Equipment | Beverages | Cleaning | Other
  
  -- Audit
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  
  -- De-duplication: prevent same invoice being inserted twice
  UNIQUE (vendor_name, invoice_date, total_amount)
);

-- 2. INVOICE_ITEMS (Detail table)
CREATE TABLE IF NOT EXISTS invoice_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  
  product_code    TEXT,               -- e.g. "AF10041"
  description     TEXT NOT NULL,      -- e.g. "SAKURA TRADING PICKLED GINGER"
  standard        TEXT,               -- e.g. "1kg/10", "20gx100p/5"
  quantity        NUMERIC(10,3),      -- 3 decimals: 4.555 for weighed items
  unit            TEXT,               -- EA, EA(kg), etc.
  price           NUMERIC(10,2),      -- unit price excluding GST
  amount_excl_gst NUMERIC(10,2),      -- qty * price
  
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. INDEXES for fast queries
CREATE INDEX IF NOT EXISTS idx_invoices_vendor   ON invoices(vendor_name);
CREATE INDEX IF NOT EXISTS idx_invoices_date     ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_category ON invoices(category);
CREATE INDEX IF NOT EXISTS idx_items_invoice     ON invoice_items(invoice_id);

-- 4. Enable Row Level Security (RLS) — service role key bypasses this
ALTER TABLE invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

-- 5. Allow all operations via service role (used in app)
CREATE POLICY "Service role full access on invoices"
  ON invoices FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access on invoice_items"  
  ON invoice_items FOR ALL
  USING (true)
  WITH CHECK (true);

-- ✅ Done! 
-- Expected tables: invoices, invoice_items
-- Expected indexes: 5 indexes
