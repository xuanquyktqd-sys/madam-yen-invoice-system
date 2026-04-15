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

export type SaveResult = {
  success: boolean;
  invoiceId?: string;
  duplicate?: boolean;
  error?: string;
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
  const dataRes = await pool.query(
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

  return { invoices: dataRes.rows, total };
}

// ── Update invoice fields ──────────────────────────────────────────────────
export async function patchInvoice(
  id: string,
  updates: Record<string, unknown>
): Promise<boolean> {
  const allowed = ['status', 'vendor_name', 'invoice_number', 'invoice_date',
                   'sub_total', 'gst_amount', 'total_amount', 'category'];
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
