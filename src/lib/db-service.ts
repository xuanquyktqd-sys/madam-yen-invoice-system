/**
 * Database Service — Madam Yen IMS
 * Skill: database-architect.md
 *
 * Uses pg (node-postgres) directly via DATABASE_URL for reliable DDL/DML.
 * Supabase JS client is used ONLY for Storage operations.
 */

import { Pool } from 'pg';
import { InvoiceData, deriveCategory } from './ocr-service';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
});

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: string } | null;
  // 42P01 = undefined_table
  return !!e && e.code === '42P01';
}

export type SaveResult = {
  success: boolean;
  invoiceId?: string;
  duplicate?: boolean;
  error?: string;
};

export type ManualInvoiceItemInput = {
  product_code?: string | null;
  description: string;
  standard?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  price?: number | string | null;
  amount_excl_gst?: number | string | null;
};

export type ManualInvoiceInput = {
  vendor_name: string;
  vendor_gst_number?: string | null;
  invoice_number?: string | null;
  invoice_date: string; // YYYY-MM-DD
  category?: string | null;
  sub_total?: number | string | null;
  freight?: number | string | null;
  gst_amount?: number | string | null;
  total_amount: number | string;
  status?: 'pending_review' | 'approved' | 'rejected';
  invoice_items?: ManualInvoiceItemInput[];
  image_url?: string | null;
};

// ── De-duplication ─────────────────────────────────────────────────────────
async function checkDuplicate(
  vendorName: string,
  invoiceDate: string,
  totalAmount: number
): Promise<string | null> {
  const res = await pool.query(
    `SELECT id FROM invoices WHERE vendor_name=$1 AND invoice_date=$2 AND total_amount=$3`,
    [vendorName, invoiceDate, totalAmount]
  );
  return res.rows[0]?.id ?? null;
}

function normalizeInvoiceRow(row: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = { ...row };
  r.sub_total = toNumberOrNull(r.sub_total) ?? 0;
  r.freight = toNumberOrNull(r.freight) ?? 0;
  r.gst_amount = toNumberOrNull(r.gst_amount) ?? 0;
  r.total_amount = toNumberOrNull(r.total_amount) ?? 0;

  if (Array.isArray(r.invoice_items)) {
    r.invoice_items = (r.invoice_items as Record<string, unknown>[]).map((it) => ({
      ...it,
      quantity: toNumberOrNull(it.quantity) ?? 0,
      price: toNumberOrNull(it.price) ?? 0,
      amount_excl_gst: toNumberOrNull(it.amount_excl_gst) ?? 0,
    }));
  }

  return r;
}

export async function getInvoiceById(id: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await pool.query(
      `SELECT i.*,
         i.vendor_id AS vendor_id,
         v.name AS vendor_name_catalog,
         v.gst_number AS vendor_gst_number_catalog,
         v.address AS vendor_address_catalog,
         json_agg(
           json_build_object(
             'id', ii.id,
             'invoice_id', ii.invoice_id,
             'product_id', ii.product_id,
             'unit_id', ii.unit_id,
             'standard_id', ii.standard_id,
             'restaurant_product_id', rp.restaurant_product_id,
             'product_code', COALESCE(ii.product_code, rp.vendor_product_code),
             'description', COALESCE(ii.description, rp.name),
             'standard', COALESCE(ii.standard, s.value),
             'quantity', ii.quantity,
             'unit', COALESCE(ii.unit, u.code),
             'price', ii.price,
             'amount_excl_gst', ii.amount_excl_gst
           ) ORDER BY ii.created_at
         ) FILTER (WHERE ii.id IS NOT NULL) AS invoice_items
       FROM invoices i
       LEFT JOIN vendors v ON v.id = i.vendor_id
       LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
       LEFT JOIN restaurant_products rp ON rp.id = ii.product_id
       LEFT JOIN units u ON u.id = ii.unit_id
       LEFT JOIN standards s ON s.id = ii.standard_id
       WHERE i.id = $1
       GROUP BY i.id, v.id`,
      [id]
    );

    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? normalizeInvoiceRow(row) : null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;

    // Backward-compatible fallback (before catalog tables exist)
    const res = await pool.query(
      `SELECT i.*,
         json_agg(
           json_build_object(
             'id', ii.id, 'product_code', ii.product_code, 'description', ii.description,
             'standard', ii.standard, 'quantity', ii.quantity, 'unit', ii.unit,
             'price', ii.price, 'amount_excl_gst', ii.amount_excl_gst
           ) ORDER BY ii.created_at
         ) FILTER (WHERE ii.id IS NOT NULL) AS invoice_items
       FROM invoices i
       LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
       WHERE i.id = $1
       GROUP BY i.id`,
      [id]
    );

    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? normalizeInvoiceRow(row) : null;
  }
}

// ── Save invoice + items ────────────────────────────────────────────────────
export async function saveInvoice(
  data: InvoiceData,
  imageUrl: string
): Promise<SaveResult> {
  const { invoice_metadata, billing_info, line_items, totals } = data;
  const client = await pool.connect();

  try {
    const vendorName  = invoice_metadata.vendor_name;
    const invoiceDate = invoice_metadata.date;
    const totalAmount = totals.total_amount;

    // De-dupe check
    const existingId = await checkDuplicate(vendorName, invoiceDate, totalAmount);
    if (existingId) {
      console.warn(`[DB] ⚠️ Duplicate: ${existingId}`);
      return { success: false, invoiceId: existingId, duplicate: true };
    }

    await client.query('BEGIN');

    // Insert invoice
    const invRes = await client.query(
      `INSERT INTO invoices
        (type, vendor_name, vendor_address, vendor_gst_number, invoice_number,
         invoice_date, currency, is_tax_invoice, billing_name, billing_address,
         sub_total, freight, gst_amount, total_amount, image_url, status, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        invoice_metadata.type ?? 'Tax Invoice',
        vendorName,
        invoice_metadata.vendor_address,
        invoice_metadata.vendor_gst_number,
        invoice_metadata.invoice_number,
        invoiceDate,
        invoice_metadata.currency ?? 'NZD',
        invoice_metadata.is_tax_invoice ?? true,
        billing_info.billing_name,
        billing_info.billing_address,
        totals.sub_total,
        totals.freight ?? 0,
        totals.gst_amount,
        totalAmount,
        imageUrl,
        'pending_review',
        deriveCategory(vendorName),
      ]
    );

    const invoiceId: string = invRes.rows[0].id;
    console.log(`[DB] ✅ Invoice: ${invoiceId}`);

    // Insert line items
    if (line_items?.length) {
      for (const item of line_items) {
        await client.query(
          `INSERT INTO invoice_items
            (invoice_id, product_code, description, standard, quantity, unit, price, amount_excl_gst)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [invoiceId, item.product_code, item.description, item.standard,
           item.quantity, item.unit, item.price, item.amount_excl_gst]
        );
      }
      console.log(`[DB] ✅ ${line_items.length} items saved`);
    }

    await client.query('COMMIT');
    return { success: true, invoiceId };

  } catch (err) {
    await client.query('ROLLBACK');
    const msg = (err as Error).message;
    console.error('[DB] ❌ Transaction rolled back:', msg);
    return { success: false, error: msg };
  } finally {
    client.release();
  }
}

// ── Create invoice manually (optional items) ───────────────────────────────
export async function createManualInvoice(input: ManualInvoiceInput): Promise<SaveResult> {
  const client = await pool.connect();

  try {
    const vendorName = input.vendor_name?.trim();
    if (!vendorName) return { success: false, error: 'vendor_name is required' };

    const invoiceDate = input.invoice_date;
    if (!invoiceDate) return { success: false, error: 'invoice_date is required' };

    const totalAmount = toNumberOrNull(input.total_amount);
    if (totalAmount === null) return { success: false, error: 'total_amount is required' };

    const existingId = await checkDuplicate(vendorName, invoiceDate, totalAmount);
    if (existingId) {
      return { success: false, invoiceId: existingId, duplicate: true };
    }

    const invoiceItems = Array.isArray(input.invoice_items) ? input.invoice_items : [];

    await client.query('BEGIN');

    const invRes = await client.query(
      `INSERT INTO invoices
        (type, vendor_name, vendor_gst_number, invoice_number, invoice_date, currency, is_tax_invoice,
         sub_total, freight, gst_amount, total_amount, image_url, status, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        'Tax Invoice',
        vendorName,
        input.vendor_gst_number ?? null,
        input.invoice_number ?? null,
        invoiceDate,
        'NZD',
        true,
        toNumberOrNull(input.sub_total) ?? 0,
        toNumberOrNull(input.freight) ?? 0,
        toNumberOrNull(input.gst_amount) ?? 0,
        totalAmount,
        input.image_url ?? null,
        input.status ?? 'pending_review',
        (input.category ?? null) || deriveCategory(vendorName),
      ]
    );

    const invoiceId: string = invRes.rows[0].id;

    if (invoiceItems.length) {
      for (const item of invoiceItems) {
        const description = item.description?.trim();
        if (!description) continue;

        await client.query(
          `INSERT INTO invoice_items
            (invoice_id, product_code, description, standard, quantity, unit, price, amount_excl_gst)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            invoiceId,
            item.product_code ?? null,
            description,
            item.standard ?? null,
            toNumberOrNull(item.quantity),
            item.unit ?? null,
            toNumberOrNull(item.price),
            toNumberOrNull(item.amount_excl_gst),
          ]
        );
      }
    }

    await client.query('COMMIT');
    return { success: true, invoiceId };
  } catch (err) {
    await client.query('ROLLBACK');
    return { success: false, error: (err as Error).message };
  } finally {
    client.release();
  }
}

export async function patchInvoiceWithItems(
  id: string,
  updates: Record<string, unknown>,
  invoiceItems?: ManualInvoiceItemInput[]
): Promise<boolean> {
  const allowed = [
    'status',
    'vendor_name',
    'vendor_gst_number',
    'invoice_number',
    'invoice_date',
    'sub_total',
    'freight',
    'gst_amount',
    'total_amount',
    'category',
  ];

  const fields = Object.keys(updates).filter((k) => allowed.includes(k));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (fields.length) {
      const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
      const values = fields.map((f) => updates[f]);
      await client.query(
        `UPDATE invoices SET ${setClauses}, updated_at=NOW() WHERE id=$1`,
        [id, ...values]
      );
    }

    if (Array.isArray(invoiceItems)) {
      await client.query(`DELETE FROM invoice_items WHERE invoice_id=$1`, [id]);
      for (const item of invoiceItems) {
        const description = item.description?.trim();
        if (!description) continue;
        await client.query(
          `INSERT INTO invoice_items
            (invoice_id, product_code, description, standard, quantity, unit, price, amount_excl_gst)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            item.product_code ?? null,
            description,
            item.standard ?? null,
            toNumberOrNull(item.quantity),
            item.unit ?? null,
            toNumberOrNull(item.price),
            toNumberOrNull(item.amount_excl_gst),
          ]
        );
      }
    }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DB] ❌ patchInvoiceWithItems rolled back:', (err as Error).message);
    return false;
  } finally {
    client.release();
  }
}

// ── Update status ──────────────────────────────────────────────────────────
export async function updateInvoiceStatus(
  invoiceId: string,
  status: 'approved' | 'rejected'
): Promise<boolean> {
  try {
    await pool.query(
      `UPDATE invoices SET status=$1, updated_at=NOW() WHERE id=$2`,
      [status, invoiceId]
    );
    console.log(`[DB] ✅ Status updated: ${invoiceId} → ${status}`);
    return true;
  } catch (err) {
    console.error('[DB] ❌ Status update failed:', (err as Error).message);
    return false;
  }
}

// ── List invoices with items ───────────────────────────────────────────────
export async function listInvoices(opts: {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ invoices: Record<string, unknown>[]; total: number }> {
  const { status, search, limit = 20, offset = 0 } = opts;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (status && status !== 'all') {
    conditions.push(`i.status = $${idx++}`);
    params.push(status);
  }
  if (search) {
    conditions.push(`(i.vendor_name ILIKE $${idx} OR i.invoice_number ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM invoices i ${where}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  // Data
  let dataRes;
  try {
    dataRes = await pool.query(
      `SELECT i.*,
         i.vendor_id AS vendor_id,
         v.name AS vendor_name_catalog,
         json_agg(
           json_build_object(
             'id', ii.id,
             'product_id', ii.product_id,
             'unit_id', ii.unit_id,
             'standard_id', ii.standard_id,
             'restaurant_product_id', rp.restaurant_product_id,
             'product_code', COALESCE(ii.product_code, rp.vendor_product_code),
             'description', COALESCE(ii.description, rp.name),
             'standard', COALESCE(ii.standard, s.value),
             'quantity', ii.quantity,
             'unit', COALESCE(ii.unit, u.code),
             'price', ii.price,
             'amount_excl_gst', ii.amount_excl_gst
           ) ORDER BY ii.created_at
         ) FILTER (WHERE ii.id IS NOT NULL) AS invoice_items
       FROM invoices i
       LEFT JOIN vendors v ON v.id = i.vendor_id
       LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
       LEFT JOIN restaurant_products rp ON rp.id = ii.product_id
       LEFT JOIN units u ON u.id = ii.unit_id
       LEFT JOIN standards s ON s.id = ii.standard_id
       ${where}
       GROUP BY i.id, v.id
       ORDER BY i.invoice_date DESC, i.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    dataRes = await pool.query(
      `SELECT i.*,
         json_agg(
           json_build_object(
             'id', ii.id, 'product_code', ii.product_code, 'description', ii.description,
             'standard', ii.standard, 'quantity', ii.quantity, 'unit', ii.unit,
             'price', ii.price, 'amount_excl_gst', ii.amount_excl_gst
           ) ORDER BY ii.created_at
         ) FILTER (WHERE ii.id IS NOT NULL) AS invoice_items
       FROM invoices i
       LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
       ${where}
       GROUP BY i.id
       ORDER BY i.invoice_date DESC, i.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );
  }

  // node-postgres returns NUMERIC as string by default; normalize to numbers for the UI.
  const invoices = dataRes.rows.map((row) => normalizeInvoiceRow(row as Record<string, unknown>));

  return { invoices, total };
}

// ── Update invoice fields ──────────────────────────────────────────────────
export async function patchInvoice(
  id: string,
  updates: Record<string, unknown>
): Promise<boolean> {
  const allowed = [
    'status',
    'vendor_name',
    'vendor_gst_number',
    'invoice_number',
    'invoice_date',
    'sub_total',
    'freight',
    'gst_amount',
    'total_amount',
    'category',
  ];
  const fields = Object.keys(updates).filter(k => allowed.includes(k));
  if (!fields.length) return false;

  const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = fields.map(f => updates[f]);

  await pool.query(
    `UPDATE invoices SET ${setClauses}, updated_at=NOW() WHERE id=$1`,
    [id, ...values]
  );
  return true;
}

// ── Get invoice image url ─────────────────────────────────────────────────
export async function getInvoiceImageUrl(id: string): Promise<string | null> {
  const res = await pool.query(`SELECT image_url FROM invoices WHERE id=$1`, [id]);
  return res.rows[0]?.image_url ?? null;
}

// ── Delete invoice (cascades to invoice_items) ────────────────────────────
export async function deleteInvoice(id: string): Promise<boolean> {
  const res = await pool.query(`DELETE FROM invoices WHERE id=$1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

// ── Catalog list helpers (used for UI datalist/dropdown) ───────────────────
export async function listVendors(limit = 200): Promise<string[]> {
  try {
    const res = await pool.query(`SELECT name FROM vendors ORDER BY name ASC LIMIT $1`, [limit]);
    return res.rows.map((r) => r.name as string).filter(Boolean);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export async function listUnits(limit = 200): Promise<string[]> {
  try {
    const res = await pool.query(`SELECT code FROM units ORDER BY code ASC LIMIT $1`, [limit]);
    return res.rows.map((r) => r.code as string).filter(Boolean);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export async function listStandards(limit = 200): Promise<string[]> {
  try {
    const res = await pool.query(`SELECT value FROM standards ORDER BY value ASC LIMIT $1`, [limit]);
    return res.rows.map((r) => r.value as string).filter(Boolean);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}
