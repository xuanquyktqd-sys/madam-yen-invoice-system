  -- ============================================================
  -- FINANCE APP — Extended Schema
  -- Run this in: Supabase Dashboard > SQL Editor
  -- ============================================================

  -- 1. DAILY SALES
  CREATE TABLE IF NOT EXISTS daily_sales (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_date     DATE NOT NULL UNIQUE,
    total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
    order_count   INTEGER DEFAULT 0,
    source        TEXT DEFAULT 'manual',
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- 2. UTILITY BILLS
  CREATE TABLE IF NOT EXISTS utility_bills (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category         TEXT NOT NULL,
    supplier         TEXT,
    total_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    bill_number      TEXT,
    period_start     DATE,
    period_end       DATE,
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
  );

  -- 3. LABOUR COSTS
  CREATE TABLE IF NOT EXISTS labour_cost (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cost_type        TEXT NOT NULL, -- 'salary' | 'cash' | 'contractor'
    employee_name    TEXT,
    amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
    pay_date         DATE NOT NULL,
    period_start     DATE,
    period_end       DATE,
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
  );

  -- 4. OTHER EXPENSES
  CREATE TABLE IF NOT EXISTS other_exp (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category         TEXT NOT NULL,
    supplier         TEXT,
    amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
    expense_date     DATE NOT NULL,
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
  );

  -- 5. UNIFIED EXPENSES VIEW (Corrected Union)
  DROP VIEW IF EXISTS expenses CASCADE;
  CREATE OR REPLACE VIEW expenses AS
    -- Invoices (Purchases)
    SELECT
      i.id,
      'purchase'::text AS expense_type,
      COALESCE(i.category, 'Uncategorized')::text AS category,
      i.vendor_name AS supplier,
      i.invoice_date AS expense_date,
      i.invoice_date AS period_start,
      i.invoice_date AS period_end,
      i.total_amount AS amount,
      i.created_at
    FROM invoices i
    WHERE i.status IN ('approved', 'paid')
      AND NOT (COALESCE(i.type, '') ILIKE '%credit%' OR COALESCE(i.total_amount, 0) < 0)

    UNION ALL

    -- Utility Bills
    SELECT
      id,
      'utility'::text AS expense_type,
      category,
      supplier,
      COALESCE(period_start, created_at::date) AS expense_date,
      period_start,
      period_end,
      total_amount AS amount,
      created_at
    FROM utility_bills

    UNION ALL

    -- Labour
    SELECT
      id,
      'labour'::text AS expense_type,
      cost_type AS category,
      employee_name AS supplier,
      pay_date AS expense_date,
      period_start,
      period_end,
      amount,
      created_at
    FROM labour_cost

    UNION ALL

    -- Other
    SELECT
      id,
      'other'::text AS expense_type,
      category,
      supplier,
      expense_date,
      expense_date AS period_start,
      expense_date AS period_end,
      amount,
      created_at
    FROM other_exp;

  -- 6. ALLOCATED EXPENSES FUNCTION
  DROP FUNCTION IF EXISTS get_allocated_expenses(DATE, DATE);
  CREATE OR REPLACE FUNCTION get_allocated_expenses(from_date DATE, to_date DATE)
  RETURNS TABLE (
    date DATE,
    expense_type TEXT,
    category TEXT,
    supplier TEXT,
    amount NUMERIC
  ) AS $$
  BEGIN
    RETURN QUERY
    WITH daily_exp AS (
      -- For single day expenses
      SELECT 
        e.expense_date as d,
        e.expense_type,
        e.category,
        e.supplier,
        e.amount
      FROM expenses e
      WHERE e.period_start IS NULL OR e.period_start = e.period_end

      UNION ALL

      -- For period expenses (pro-rated)
      SELECT 
        generate_series(e.period_start, e.period_end, '1 day'::interval)::date as d,
        e.expense_type,
        e.category,
        e.supplier,
        e.amount / (e.period_end - e.period_start + 1) as amount
      FROM expenses e
      WHERE e.period_start IS NOT NULL AND e.period_start < e.period_end
    )
    SELECT 
      daily_exp.d,
      daily_exp.expense_type,
      daily_exp.category,
      daily_exp.supplier,
      SUM(daily_exp.amount)::NUMERIC
    FROM daily_exp
    WHERE daily_exp.d >= from_date AND daily_exp.d <= to_date
    GROUP BY daily_exp.d, daily_exp.expense_type, daily_exp.category, daily_exp.supplier;
  END;
  $$ LANGUAGE plpgsql;
