  -- ============================================================
  -- FINANCE APP — Extended Schema
  -- Run this in: Supabase Dashboard > SQL Editor
  -- AFTER running supabase-schema.sql and SQL_AUTH_AND_RBAC.sql
  -- ============================================================

  -- ═══════════════════════════════════════════════════════════════
  -- 1. DAILY SALES (Revenue — manual entry, API sync later)
  -- ═══════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS daily_sales (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_date     DATE NOT NULL UNIQUE,
    total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
    order_count   INTEGER DEFAULT 0,
    source        TEXT DEFAULT 'manual',  -- 'manual' | 'api'
    raw_data      JSONB,                  -- full API response for audit trail
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_daily_sales_date ON daily_sales(sale_date);

  ALTER TABLE daily_sales ENABLE ROW LEVEL SECURITY;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='daily_sales' AND policyname='Service role full access on daily_sales') THEN
      CREATE POLICY "Service role full access on daily_sales"
        ON daily_sales FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$;

  -- ═══════════════════════════════════════════════════════════════
  -- 2. UTILITY BILLS (Operating expenses — electricity, water, gas, internet)
  -- ═══════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS utility_bills (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category         TEXT NOT NULL,              -- 'electricity' | 'water' | 'gas' | 'internet' | 'phone' | 'other'
    supplier         TEXT,                       -- provider name e.g. 'Mercury', 'Spark'
    bill_number      TEXT,
    period_start     DATE,                       -- billing period start
    period_end       DATE,                       -- billing period end
    total_amount     NUMERIC(12,2) NOT NULL,     -- total amount (incl GST for NZ bills)
    amount_excl_gst  NUMERIC(12,2),              -- amount excluding GST
    gst_amount       NUMERIC(12,2),              -- GST component
    gmail_message_id TEXT,                       -- for Gmail sync dedup
    image_url        TEXT,                       -- receipt/bill image
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    -- Dedup: same category + supplier + period + amount
    UNIQUE (category, supplier, period_start, total_amount)
  );

  CREATE INDEX IF NOT EXISTS idx_utility_bills_category ON utility_bills(category);
  CREATE INDEX IF NOT EXISTS idx_utility_bills_period ON utility_bills(period_start, period_end);
  CREATE INDEX IF NOT EXISTS idx_utility_bills_gmail ON utility_bills(gmail_message_id) WHERE gmail_message_id IS NOT NULL;

  ALTER TABLE utility_bills ENABLE ROW LEVEL SECURITY;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='utility_bills' AND policyname='Service role full access on utility_bills') THEN
      CREATE POLICY "Service role full access on utility_bills"
        ON utility_bills FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$;

  -- ═══════════════════════════════════════════════════════════════
  -- 3. LABOUR COST (Staff expenses — cash, wages, salary)
  -- ═══════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS labour_cost (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cost_type     TEXT NOT NULL,                -- 'cash' | 'wage' | 'salary'
    description   TEXT,
    amount        NUMERIC(12,2) NOT NULL,
    pay_date      DATE NOT NULL,                -- date of payment
    period_start  DATE,                         -- pay period start (for wages/salary)
    period_end    DATE,                         -- pay period end
    employee_name TEXT,
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_labour_cost_type ON labour_cost(cost_type);
  CREATE INDEX IF NOT EXISTS idx_labour_cost_date ON labour_cost(pay_date);
  CREATE INDEX IF NOT EXISTS idx_labour_cost_period ON labour_cost(period_start, period_end);

  ALTER TABLE labour_cost ENABLE ROW LEVEL SECURITY;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='labour_cost' AND policyname='Service role full access on labour_cost') THEN
      CREATE POLICY "Service role full access on labour_cost"
        ON labour_cost FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$;

  -- ═══════════════════════════════════════════════════════════════
  -- 4. OTHER EXPENSES (Rent, marketing, insurance, misc)
  -- ═══════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS other_exp (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category      TEXT NOT NULL,                -- 'rent' | 'marketing' | 'insurance' | 'equipment' | 'misc'
    description   TEXT,
    amount        NUMERIC(12,2) NOT NULL,
    expense_date  DATE NOT NULL,
    period_start  DATE,                         -- optional: for prorated expenses
    period_end    DATE,
    supplier      TEXT,                         -- who was paid
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_other_exp_category ON other_exp(category);
  CREATE INDEX IF NOT EXISTS idx_other_exp_date ON other_exp(expense_date);

  ALTER TABLE other_exp ENABLE ROW LEVEL SECURITY;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='other_exp' AND policyname='Service role full access on other_exp') THEN
      CREATE POLICY "Service role full access on other_exp"
        ON other_exp FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$;

  -- ═══════════════════════════════════════════════════════════════
  -- 5. EXPENSES VIEW (Unified view of ALL expenses)
  -- ═══════════════════════════════════════════════════════════════
  CREATE OR REPLACE VIEW expenses AS

    -- Purchase invoices (from existing invoices table — approved/paid only, excluding credit notes)
    SELECT
      i.id,
      'purchase'::text AS expense_type,
      COALESCE(i.category, 'Uncategorized')::text AS category,
      i.vendor_name AS supplier,
      i.invoice_date AS expense_date,
      i.invoice_date AS period_start,
      i.invoice_date AS period_end,
      COALESCE(i.sub_total, 0) + COALESCE(i.freight, 0) AS amount_excl_gst,
      COALESCE(i.total_amount, 0) AS amount_incl_gst,
      i.created_at
    FROM invoices i
    WHERE i.status IN ('approved', 'paid')
      AND NOT (
        COALESCE(i.type, '') ILIKE '%credit%'
        OR COALESCE(i.total_amount, 0) < 0
        OR i.parent_invoice_id IS NOT NULL
      )

    UNION ALL

    -- Utility bills
    SELECT
      ub.id,
      'utility'::text AS expense_type,
      ub.category,
      ub.supplier,
      COALESCE(ub.period_start, ub.created_at::date) AS expense_date,
      ub.period_start,
      ub.period_end,
      COALESCE(ub.amount_excl_gst, ub.total_amount) AS amount_excl_gst,
      ub.total_amount AS amount_incl_gst,
      ub.created_at
    FROM utility_bills ub

    UNION ALL

    -- Labour cost
    SELECT
      lc.id,
      'labour'::text AS expense_type,
      lc.cost_type AS category,
      lc.employee_name AS supplier,
      lc.pay_date AS expense_date,
      lc.period_start,
      lc.period_end,
      lc.amount AS amount_excl_gst,
      lc.amount AS amount_incl_gst,
      lc.created_at
    FROM labour_cost lc

    UNION ALL

    -- Other expenses
    SELECT
      oe.id,
      'other'::text AS expense_type,
      oe.category,
      oe.supplier,
      oe.expense_date,
      COALESCE(oe.period_start, oe.expense_date) AS period_start,
      COALESCE(oe.period_end, oe.expense_date) AS period_end,
      oe.amount AS amount_excl_gst,
      oe.amount AS amount_incl_gst,
      oe.created_at
    FROM other_exp oe;

  -- ═══════════════════════════════════════════════════════════════
  -- 6. EXPENSE ALLOCATION FUNCTION
  -- Pro-rates expenses into a given date range based on their period
  -- Example: A bill covering 01/05–20/05 ($160 for 16 business-days)
  --          queried for week 08/05–14/05 → returns $70 (7/16 * $160)
  -- ═══════════════════════════════════════════════════════════════
  CREATE OR REPLACE FUNCTION get_allocated_expenses(
    p_start_date DATE,
    p_end_date DATE
  )
  RETURNS TABLE (
    expense_type TEXT,
    category TEXT,
    total_amount NUMERIC
  )
  LANGUAGE SQL STABLE
  AS $$
    SELECT
      e.expense_type,
      e.category,
      SUM(
        CASE
          -- No period or single-day period: take full amount if within range
          WHEN e.period_end IS NULL
            OR e.period_start IS NULL
            OR e.period_end = e.period_start
          THEN e.amount_excl_gst
          -- Multi-day period: pro-rate by overlap
          ELSE e.amount_excl_gst
            * GREATEST(
                0,
                (LEAST(e.period_end, p_end_date)
                - GREATEST(e.period_start, p_start_date) + 1)::numeric
                / NULLIF((e.period_end - e.period_start + 1)::numeric, 0)
              )
        END
      ) AS total_amount
    FROM expenses e
    WHERE e.period_start <= p_end_date
      AND COALESCE(e.period_end, e.period_start) >= p_start_date
    GROUP BY e.expense_type, e.category;
  $$;

  -- ✅ Done!
  -- New tables: daily_sales, utility_bills, labour_cost, other_exp
  -- New view: expenses
  -- New function: get_allocated_expenses(DATE, DATE)
