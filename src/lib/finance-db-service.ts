/**
 * Finance DB Service — Madam Yen Finance App
 *
 * Separate DB layer for finance modules (revenue, utility bills, labour, other expenses).
 * Reuses the same pg Pool pattern as db-service.ts but does NOT modify that file.
 */

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
});

// ── Helpers ────────────────────────────────────────────────────────────────

function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ══════════════════════════════════════════════════════════════════════════
// DAILY SALES (Revenue)
// ══════════════════════════════════════════════════════════════════════════

export type DailySalesRow = {
  id: string;
  sale_date: string;
  total_revenue: number;
  order_count: number;
  source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type DailySalesInput = {
  sale_date: string; // YYYY-MM-DD
  total_revenue: number | string;
  order_count?: number | string | null;
  source?: string;
  notes?: string | null;
  raw_data?: Record<string, unknown> | null;
};

export async function upsertDailySales(input: DailySalesInput): Promise<DailySalesRow> {
  const revenue = toNum(input.total_revenue) ?? 0;
  const orderCount = toNum(input.order_count) ?? 0;
  const source = input.source ?? 'manual';

  const res = await pool.query(
    `INSERT INTO daily_sales (sale_date, total_revenue, order_count, source, notes, raw_data, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (sale_date) DO UPDATE
       SET total_revenue = EXCLUDED.total_revenue,
           order_count = EXCLUDED.order_count,
           source = EXCLUDED.source,
           notes = COALESCE(EXCLUDED.notes, daily_sales.notes),
           raw_data = COALESCE(EXCLUDED.raw_data, daily_sales.raw_data),
           updated_at = NOW()
     RETURNING *`,
    [input.sale_date, revenue, orderCount, source, input.notes ?? null, input.raw_data ? JSON.stringify(input.raw_data) : null]
  );

  const row = res.rows[0];
  return normalizeDailySalesRow(row);
}

export async function listDailySales(opts: {
  from?: string;
  to?: string;
}): Promise<DailySalesRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts.from) { conditions.push(`sale_date >= $${idx++}`); params.push(opts.from); }
  if (opts.to) { conditions.push(`sale_date <= $${idx++}`); params.push(opts.to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await pool.query(
    `SELECT * FROM daily_sales ${where} ORDER BY sale_date DESC`,
    params
  );
  return res.rows.map(normalizeDailySalesRow);
}

export async function deleteDailySales(id: string): Promise<boolean> {
  const res = await pool.query(`DELETE FROM daily_sales WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

function normalizeDailySalesRow(row: Record<string, unknown>): DailySalesRow {
  return {
    id: String(row.id),
    sale_date: String(row.sale_date ?? '').slice(0, 10),
    total_revenue: toNum(row.total_revenue) ?? 0,
    order_count: toNum(row.order_count) ?? 0,
    source: String(row.source ?? 'manual'),
    notes: row.notes ? String(row.notes) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// UTILITY BILLS
// ══════════════════════════════════════════════════════════════════════════

export type UtilityBillRow = {
  id: string;
  category: string;
  supplier: string | null;
  bill_number: string | null;
  period_start: string | null;
  period_end: string | null;
  total_amount: number;
  amount_excl_gst: number | null;
  gst_amount: number | null;
  gmail_message_id: string | null;
  image_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type UtilityBillInput = {
  category: string;
  supplier?: string | null;
  bill_number?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  total_amount: number | string;
  amount_excl_gst?: number | string | null;
  gst_amount?: number | string | null;
  gmail_message_id?: string | null;
  image_url?: string | null;
  notes?: string | null;
};

export async function createUtilityBill(input: UtilityBillInput): Promise<UtilityBillRow> {
  const totalAmount = toNum(input.total_amount) ?? 0;
  const amountExGst = toNum(input.amount_excl_gst);
  const gstAmount = toNum(input.gst_amount);

  // Auto-compute GST if not provided (NZ 15%)
  const computedExGst = amountExGst ?? round2(totalAmount / 1.15);
  const computedGst = gstAmount ?? round2(totalAmount - computedExGst);

  const res = await pool.query(
    `INSERT INTO utility_bills
       (category, supplier, bill_number, period_start, period_end,
        total_amount, amount_excl_gst, gst_amount,
        gmail_message_id, image_url, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      input.category,
      input.supplier ?? null,
      input.bill_number ?? null,
      input.period_start ?? null,
      input.period_end ?? null,
      totalAmount,
      computedExGst,
      computedGst,
      input.gmail_message_id ?? null,
      input.image_url ?? null,
      input.notes ?? null,
    ]
  );
  return normalizeUtilityBillRow(res.rows[0]);
}

export async function updateUtilityBill(id: string, input: Partial<UtilityBillInput>): Promise<UtilityBillRow | null> {
  const existing = await pool.query(`SELECT * FROM utility_bills WHERE id = $1`, [id]);
  if (!existing.rows[0]) return null;

  const fields: string[] = [];
  const values: unknown[] = [id];
  let idx = 2;

  const setField = (name: string, value: unknown) => {
    fields.push(`${name} = $${idx++}`);
    values.push(value);
  };

  if (input.category !== undefined) setField('category', input.category);
  if (input.supplier !== undefined) setField('supplier', input.supplier);
  if (input.bill_number !== undefined) setField('bill_number', input.bill_number);
  if (input.period_start !== undefined) setField('period_start', input.period_start);
  if (input.period_end !== undefined) setField('period_end', input.period_end);
  if (input.total_amount !== undefined) {
    const total = toNum(input.total_amount) ?? 0;
    setField('total_amount', total);
    const exGst = toNum(input.amount_excl_gst) ?? round2(total / 1.15);
    const gst = toNum(input.gst_amount) ?? round2(total - exGst);
    setField('amount_excl_gst', exGst);
    setField('gst_amount', gst);
  }
  if (input.notes !== undefined) setField('notes', input.notes);
  if (input.image_url !== undefined) setField('image_url', input.image_url);

  if (!fields.length) return normalizeUtilityBillRow(existing.rows[0]);

  fields.push(`updated_at = NOW()`);

  const res = await pool.query(
    `UPDATE utility_bills SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return res.rows[0] ? normalizeUtilityBillRow(res.rows[0]) : null;
}

export async function listUtilityBills(opts: {
  from?: string;
  to?: string;
  category?: string;
}): Promise<UtilityBillRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts.from) { conditions.push(`COALESCE(period_start, created_at::date) >= $${idx++}`); params.push(opts.from); }
  if (opts.to) { conditions.push(`COALESCE(period_start, created_at::date) <= $${idx++}`); params.push(opts.to); }
  if (opts.category) { conditions.push(`category = $${idx++}`); params.push(opts.category); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await pool.query(
    `SELECT * FROM utility_bills ${where} ORDER BY COALESCE(period_start, created_at::date) DESC`,
    params
  );
  return res.rows.map(normalizeUtilityBillRow);
}

export async function deleteUtilityBill(id: string): Promise<boolean> {
  const res = await pool.query(`DELETE FROM utility_bills WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

function normalizeUtilityBillRow(row: Record<string, unknown>): UtilityBillRow {
  return {
    id: String(row.id),
    category: String(row.category ?? ''),
    supplier: row.supplier ? String(row.supplier) : null,
    bill_number: row.bill_number ? String(row.bill_number) : null,
    period_start: row.period_start ? String(row.period_start).slice(0, 10) : null,
    period_end: row.period_end ? String(row.period_end).slice(0, 10) : null,
    total_amount: toNum(row.total_amount) ?? 0,
    amount_excl_gst: toNum(row.amount_excl_gst),
    gst_amount: toNum(row.gst_amount),
    gmail_message_id: row.gmail_message_id ? String(row.gmail_message_id) : null,
    image_url: row.image_url ? String(row.image_url) : null,
    notes: row.notes ? String(row.notes) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// LABOUR COST
// ══════════════════════════════════════════════════════════════════════════

export type LabourCostRow = {
  id: string;
  cost_type: string;
  description: string | null;
  amount: number;
  pay_date: string;
  period_start: string | null;
  period_end: string | null;
  employee_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type LabourCostInput = {
  cost_type: string; // 'cash' | 'wage' | 'salary'
  description?: string | null;
  amount: number | string;
  pay_date: string;
  period_start?: string | null;
  period_end?: string | null;
  employee_name?: string | null;
  notes?: string | null;
};

export async function createLabourCost(input: LabourCostInput): Promise<LabourCostRow> {
  const amount = toNum(input.amount) ?? 0;
  const res = await pool.query(
    `INSERT INTO labour_cost
       (cost_type, description, amount, pay_date, period_start, period_end, employee_name, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      input.cost_type,
      input.description ?? null,
      amount,
      input.pay_date,
      input.period_start ?? null,
      input.period_end ?? null,
      input.employee_name ?? null,
      input.notes ?? null,
    ]
  );
  return normalizeLabourCostRow(res.rows[0]);
}

export async function updateLabourCost(id: string, input: Partial<LabourCostInput>): Promise<LabourCostRow | null> {
  const existing = await pool.query(`SELECT * FROM labour_cost WHERE id = $1`, [id]);
  if (!existing.rows[0]) return null;

  const fields: string[] = [];
  const values: unknown[] = [id];
  let idx = 2;

  const setField = (name: string, value: unknown) => {
    fields.push(`${name} = $${idx++}`);
    values.push(value);
  };

  if (input.cost_type !== undefined) setField('cost_type', input.cost_type);
  if (input.description !== undefined) setField('description', input.description);
  if (input.amount !== undefined) setField('amount', toNum(input.amount) ?? 0);
  if (input.pay_date !== undefined) setField('pay_date', input.pay_date);
  if (input.period_start !== undefined) setField('period_start', input.period_start);
  if (input.period_end !== undefined) setField('period_end', input.period_end);
  if (input.employee_name !== undefined) setField('employee_name', input.employee_name);
  if (input.notes !== undefined) setField('notes', input.notes);

  if (!fields.length) return normalizeLabourCostRow(existing.rows[0]);

  fields.push(`updated_at = NOW()`);

  const res = await pool.query(
    `UPDATE labour_cost SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return res.rows[0] ? normalizeLabourCostRow(res.rows[0]) : null;
}

export async function listLabourCosts(opts: {
  from?: string;
  to?: string;
  costType?: string;
}): Promise<LabourCostRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts.from) { conditions.push(`pay_date >= $${idx++}`); params.push(opts.from); }
  if (opts.to) { conditions.push(`pay_date <= $${idx++}`); params.push(opts.to); }
  if (opts.costType) { conditions.push(`cost_type = $${idx++}`); params.push(opts.costType); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await pool.query(
    `SELECT * FROM labour_cost ${where} ORDER BY pay_date DESC`,
    params
  );
  return res.rows.map(normalizeLabourCostRow);
}

export async function deleteLabourCost(id: string): Promise<boolean> {
  const res = await pool.query(`DELETE FROM labour_cost WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

function normalizeLabourCostRow(row: Record<string, unknown>): LabourCostRow {
  return {
    id: String(row.id),
    cost_type: String(row.cost_type ?? ''),
    description: row.description ? String(row.description) : null,
    amount: toNum(row.amount) ?? 0,
    pay_date: String(row.pay_date ?? '').slice(0, 10),
    period_start: row.period_start ? String(row.period_start).slice(0, 10) : null,
    period_end: row.period_end ? String(row.period_end).slice(0, 10) : null,
    employee_name: row.employee_name ? String(row.employee_name) : null,
    notes: row.notes ? String(row.notes) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// OTHER EXPENSES
// ══════════════════════════════════════════════════════════════════════════

export type OtherExpenseRow = {
  id: string;
  category: string;
  description: string | null;
  amount: number;
  expense_date: string;
  period_start: string | null;
  period_end: string | null;
  supplier: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OtherExpenseInput = {
  category: string; // 'rent' | 'marketing' | 'insurance' | 'equipment' | 'misc'
  description?: string | null;
  amount: number | string;
  expense_date: string;
  period_start?: string | null;
  period_end?: string | null;
  supplier?: string | null;
  notes?: string | null;
};

export async function createOtherExpense(input: OtherExpenseInput): Promise<OtherExpenseRow> {
  const amount = toNum(input.amount) ?? 0;
  const res = await pool.query(
    `INSERT INTO other_exp
       (category, description, amount, expense_date, period_start, period_end, supplier, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      input.category,
      input.description ?? null,
      amount,
      input.expense_date,
      input.period_start ?? null,
      input.period_end ?? null,
      input.supplier ?? null,
      input.notes ?? null,
    ]
  );
  return normalizeOtherExpenseRow(res.rows[0]);
}

export async function updateOtherExpense(id: string, input: Partial<OtherExpenseInput>): Promise<OtherExpenseRow | null> {
  const existing = await pool.query(`SELECT * FROM other_exp WHERE id = $1`, [id]);
  if (!existing.rows[0]) return null;

  const fields: string[] = [];
  const values: unknown[] = [id];
  let idx = 2;

  const setField = (name: string, value: unknown) => {
    fields.push(`${name} = $${idx++}`);
    values.push(value);
  };

  if (input.category !== undefined) setField('category', input.category);
  if (input.description !== undefined) setField('description', input.description);
  if (input.amount !== undefined) setField('amount', toNum(input.amount) ?? 0);
  if (input.expense_date !== undefined) setField('expense_date', input.expense_date);
  if (input.period_start !== undefined) setField('period_start', input.period_start);
  if (input.period_end !== undefined) setField('period_end', input.period_end);
  if (input.supplier !== undefined) setField('supplier', input.supplier);
  if (input.notes !== undefined) setField('notes', input.notes);

  if (!fields.length) return normalizeOtherExpenseRow(existing.rows[0]);

  fields.push(`updated_at = NOW()`);

  const res = await pool.query(
    `UPDATE other_exp SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return res.rows[0] ? normalizeOtherExpenseRow(res.rows[0]) : null;
}

export async function listOtherExpenses(opts: {
  from?: string;
  to?: string;
  category?: string;
}): Promise<OtherExpenseRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts.from) { conditions.push(`expense_date >= $${idx++}`); params.push(opts.from); }
  if (opts.to) { conditions.push(`expense_date <= $${idx++}`); params.push(opts.to); }
  if (opts.category) { conditions.push(`category = $${idx++}`); params.push(opts.category); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await pool.query(
    `SELECT * FROM other_exp ${where} ORDER BY expense_date DESC`,
    params
  );
  return res.rows.map(normalizeOtherExpenseRow);
}

export async function deleteOtherExpense(id: string): Promise<boolean> {
  const res = await pool.query(`DELETE FROM other_exp WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

function normalizeOtherExpenseRow(row: Record<string, unknown>): OtherExpenseRow {
  return {
    id: String(row.id),
    category: String(row.category ?? ''),
    description: row.description ? String(row.description) : null,
    amount: toNum(row.amount) ?? 0,
    expense_date: String(row.expense_date ?? '').slice(0, 10),
    period_start: row.period_start ? String(row.period_start).slice(0, 10) : null,
    period_end: row.period_end ? String(row.period_end).slice(0, 10) : null,
    supplier: row.supplier ? String(row.supplier) : null,
    notes: row.notes ? String(row.notes) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// FINANCE SUMMARY (P&L Overview)
// ══════════════════════════════════════════════════════════════════════════

export type FinanceSummary = {
  total_revenue: number;
  total_expenses: number;
  net_profit: number;
  profit_margin: number; // percentage
  expense_breakdown: {
    purchase: number;
    utility: number;
    labour: number;
    other: number;
  };
  daily_revenue: Array<{ date: string; revenue: number }>;
  daily_expenses: Array<{ date: string; amount: number }>;
};

export async function getFinanceSummary(opts: {
  from?: string;
  to?: string;
}): Promise<FinanceSummary> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts.from) { conditions.push(`sale_date >= $${idx++}`); params.push(opts.from); }
  if (opts.to) { conditions.push(`sale_date <= $${idx++}`); params.push(opts.to); }

  const revenueWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Revenue totals
  const revRes = await pool.query(
    `SELECT
       COALESCE(SUM(total_revenue), 0)::numeric AS total_revenue
     FROM daily_sales ${revenueWhere}`,
    params
  );
  const totalRevenue = toNum(revRes.rows[0]?.total_revenue) ?? 0;

  // Daily revenue
  const dailyRevRes = await pool.query(
    `SELECT sale_date::text AS date, total_revenue AS revenue
     FROM daily_sales ${revenueWhere}
     ORDER BY sale_date ASC`,
    params
  );
  const dailyRevenue = dailyRevRes.rows.map(r => ({
    date: String(r.date).slice(0, 10),
    revenue: toNum(r.revenue) ?? 0,
  }));

  // Expense breakdown by type
  const expConditions: string[] = [];
  const expParams: unknown[] = [];
  let eidx = 1;

  if (opts.from) { expConditions.push(`expense_date >= $${eidx++}`); expParams.push(opts.from); }
  if (opts.to) { expConditions.push(`expense_date <= $${eidx++}`); expParams.push(opts.to); }

  const expWhere = expConditions.length ? `WHERE ${expConditions.join(' AND ')}` : '';

  const expRes = await pool.query(
    `SELECT
       expense_type,
       COALESCE(SUM(amount), 0)::numeric AS total
     FROM expenses ${expWhere}
     GROUP BY expense_type`,
    expParams
  );

  const breakdown = { purchase: 0, utility: 0, labour: 0, other: 0 };
  for (const row of expRes.rows) {
    const type = String(row.expense_type) as keyof typeof breakdown;
    if (type in breakdown) {
      breakdown[type] = toNum(row.total) ?? 0;
    }
  }

  const totalExpenses = round2(breakdown.purchase + breakdown.utility + breakdown.labour + breakdown.other);
  const netProfit = round2(totalRevenue - totalExpenses);
  const profitMargin = totalRevenue > 0 ? round2((netProfit / totalRevenue) * 100) : 0;

  // Daily expenses (aggregated)
  const dailyExpRes = await pool.query(
    `SELECT expense_date::text AS date, COALESCE(SUM(amount), 0)::numeric AS amount
     FROM expenses ${expWhere}
     GROUP BY expense_date
     ORDER BY expense_date ASC`,
    expParams
  );
  const dailyExpenses = dailyExpRes.rows.map(r => ({
    date: String(r.date).slice(0, 10),
    amount: toNum(r.amount) ?? 0,
  }));

  return {
    total_revenue: totalRevenue,
    total_expenses: totalExpenses,
    net_profit: netProfit,
    profit_margin: profitMargin,
    expense_breakdown: breakdown,
    daily_revenue: dailyRevenue,
    daily_expenses: dailyExpenses,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// ALLOCATED EXPENSES (pro-rated by period)
// ══════════════════════════════════════════════════════════════════════════

export type AllocatedExpense = {
  expense_type: string;
  category: string;
  total_amount: number;
};

export async function getAllocatedExpenses(from: string, to: string): Promise<AllocatedExpense[]> {
  const res = await pool.query(
    `SELECT * FROM get_allocated_expenses($1::date, $2::date)`,
    [from, to]
  );
  return res.rows.map(row => ({
    expense_type: String(row.expense_type),
    category: String(row.category),
    total_amount: toNum(row.amount) ?? 0,
  }));
}
