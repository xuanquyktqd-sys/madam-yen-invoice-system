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

function normalizeGstNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = String(input).replace(/[^\d]/g, '').trim();
  return digits ? digits : null;
}

function normalizeVendorName(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  return s ? s.replace(/\s+/g, ' ') : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: string } | null;
  // 42P01 = undefined_table
  return !!e && e.code === '42P01';
}

function isMissingColumnError(err: unknown, column?: string): boolean {
  const e = err as { code?: string; message?: string } | null;
  // 42703 = undefined_column
  if (!e || e.code !== '42703') return false;
  if (!column) return true;
  return (e.message ?? '').includes(column);
}

async function insertInvoiceItemRow(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  row: {
    invoice_id: string;
    product_code: string | null;
    description: string;
    standard: string | null;
    quantity: number | null;
    unit: string | null;
    price: number | null;
    amount_excl_gst: number | null;
    sort_order: number;
  }
) {
  const sp = 'sp_invoice_item_insert';
  await client.query(`SAVEPOINT ${sp}`);
  try {
    await client.query(
      `INSERT INTO invoice_items
        (invoice_id, product_code, description, standard, quantity, unit, price, amount_excl_gst, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        row.invoice_id,
        row.product_code,
        row.description,
        row.standard,
        row.quantity,
        row.unit,
        row.price,
        row.amount_excl_gst,
        row.sort_order,
      ]
    );
    await client.query(`RELEASE SAVEPOINT ${sp}`);
  } catch (err) {
    // Any error inside a transaction aborts it unless we roll back to a savepoint.
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);

    if (!isMissingColumnError(err, 'sort_order')) {
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      throw err;
    }

    // Backward-compatible insert when DB hasn't been migrated to add sort_order yet.
    await client.query(
      `INSERT INTO invoice_items
         (invoice_id, product_code, description, standard, quantity, unit, price, amount_excl_gst)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        row.invoice_id,
        row.product_code,
        row.description,
        row.standard,
        row.quantity,
        row.unit,
        row.price,
        row.amount_excl_gst,
      ]
    );

    await client.query(`RELEASE SAVEPOINT ${sp}`);
  }
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
  status?: 'pending_review' | 'approved' | 'rejected' | 'paid';
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
           ) ORDER BY ii.sort_order NULLS LAST, ii.created_at, ii.id
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
    if (isMissingColumnError(err, 'sort_order')) {
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
             ) ORDER BY ii.created_at, ii.id
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
    }

    if (!isMissingTableError(err)) throw err;

    // Backward-compatible fallback (before catalog tables exist)
    const res = await pool.query(
      `SELECT i.*,
         json_agg(
           json_build_object(
             'id', ii.id, 'product_code', ii.product_code, 'description', ii.description,
             'standard', ii.standard, 'quantity', ii.quantity, 'unit', ii.unit,
             'price', ii.price, 'amount_excl_gst', ii.amount_excl_gst
           ) ORDER BY ii.created_at, ii.id
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
  imageUrl: string,
  ocrJobId?: string
): Promise<SaveResult> {
  const { invoice_metadata, line_items } = data;
  const client = await pool.connect();

  try {
    const vendorName  = invoice_metadata.vendor_name;
    const invoiceDate = invoice_metadata.date;
    const vendorGstNormalized = normalizeGstNumber(invoice_metadata.vendor_gst_number);
    const vendorNameNormalized = normalizeVendorName(vendorName);

    const matchVendor = async (): Promise<{ vendorId: string | null; pricesIncludeGst: boolean }> => {
      try {
        if (vendorGstNormalized) {
          const res = await client.query(
            `SELECT id, prices_include_gst
               FROM vendors
              WHERE regexp_replace(COALESCE(gst_number,''), '[^0-9]', '', 'g') = $1
              LIMIT 1`,
            [vendorGstNormalized]
          );
          if (res.rows[0]?.id) {
            return { vendorId: res.rows[0].id as string, pricesIncludeGst: !!res.rows[0].prices_include_gst };
          }
        }
        if (vendorNameNormalized) {
          const res = await client.query(
            `SELECT id, prices_include_gst
               FROM vendors
              WHERE lower(trim(name)) = $1
              LIMIT 1`,
            [vendorNameNormalized]
          );
          if (res.rows[0]?.id) {
            return { vendorId: res.rows[0].id as string, pricesIncludeGst: !!res.rows[0].prices_include_gst };
          }
        }
        return { vendorId: null, pricesIncludeGst: false };
      } catch (err) {
        if (isMissingColumnError(err, 'prices_include_gst')) {
          // Backward-compatible when DB hasn't been migrated yet.
          if (vendorGstNormalized) {
            const res = await client.query(
              `SELECT id
                 FROM vendors
                WHERE regexp_replace(COALESCE(gst_number,''), '[^0-9]', '', 'g') = $1
                LIMIT 1`,
              [vendorGstNormalized]
            );
            if (res.rows[0]?.id) return { vendorId: res.rows[0].id as string, pricesIncludeGst: false };
          }
          if (vendorNameNormalized) {
            const res = await client.query(
              `SELECT id
                 FROM vendors
                WHERE lower(trim(name)) = $1
                LIMIT 1`,
              [vendorNameNormalized]
            );
            if (res.rows[0]?.id) return { vendorId: res.rows[0].id as string, pricesIncludeGst: false };
          }
          return { vendorId: null, pricesIncludeGst: false };
        }
        throw err;
      }
    };

    const freight = 0;

    await client.query('BEGIN');

    const { vendorId, pricesIncludeGst } = await matchVendor();

    const normalizePriceExGst = (price: number | null): number | null => {
      if (price === null) return null;
      if (!pricesIncludeGst) return price;
      // Convert incl-GST → ex-GST using NZ 15% GST.
      // Keep 4 decimals for storage/accuracy; UI will format to 2 decimals for readability.
      return round4(price / 1.15);
    };

    const normalizedItems = (line_items ?? []).map((it) => {
      const q = toNumberOrNull(it.quantity);
      const pIncl = toNumberOrNull(it.price);
      const p = normalizePriceExGst(pIncl);
      const amt = q !== null && p !== null ? round2(q * p) : null;
      return { ...it, quantity: q, price: p, _amount_ex: amt };
    });

    const computedSubTotal = round2(
      normalizedItems.reduce((sum, it) => (it._amount_ex === null ? sum : sum + it._amount_ex), 0)
    );
    const computedGst = round2((computedSubTotal + freight) * 0.15);
    const totalAmount = round2(computedSubTotal + freight + computedGst);

    if (ocrJobId) {
      const existingByJob = await client.query(
        `SELECT id FROM invoices WHERE ocr_job_id = $1`,
        [ocrJobId]
      );
      if (existingByJob.rows[0]?.id) {
        await client.query('COMMIT');
        return { success: true, invoiceId: existingByJob.rows[0].id };
      }
    }

    // De-dupe check
    const existingId = await checkDuplicate(vendorName, invoiceDate, totalAmount);
    if (existingId) {
      if (ocrJobId) {
        await client.query(
          `UPDATE invoices
           SET ocr_job_id = COALESCE(ocr_job_id, $2), updated_at = NOW()
           WHERE id = $1`,
          [existingId, ocrJobId]
        );
        await client.query('COMMIT');
        console.warn(`[DB] ⚠️ Duplicate linked to OCR job: ${existingId}`);
        return { success: true, invoiceId: existingId, duplicate: true };
      }

      await client.query('ROLLBACK');
      console.warn(`[DB] ⚠️ Duplicate: ${existingId}`);
      return { success: false, invoiceId: existingId, duplicate: true };
    }

    // Insert invoice
    const invRes = await client.query(
      `INSERT INTO invoices
        (type, vendor_name, vendor_address, vendor_gst_number, invoice_number,
         invoice_date, currency, is_tax_invoice, billing_name, billing_address,
         sub_total, freight, gst_amount, total_amount, image_url, status, category, ocr_job_id, vendor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        'Tax Invoice',
        vendorName,
        null,
        invoice_metadata.vendor_gst_number,
        invoice_metadata.invoice_number,
        invoiceDate,
        'NZD',
        true,
        null,
        null,
        computedSubTotal,
        freight,
        computedGst,
        totalAmount,
        imageUrl,
        'pending_review',
        deriveCategory(vendorName),
        ocrJobId ?? null,
        vendorId,
      ]
    );

    const invoiceId: string = invRes.rows[0].id;
    console.log(`[DB] ✅ Invoice: ${invoiceId}`);

    // Insert line items
    if (normalizedItems.length) {
      for (let i = 0; i < normalizedItems.length; i++) {
        const item = normalizedItems[i];
        const q = item.quantity;
        const p = item.price;
        const amount = item._amount_ex;
        await insertInvoiceItemRow(client, {
          invoice_id: invoiceId,
          product_code: item.product_code ?? null,
          description: item.description,
          standard: (item as { standard?: string | null }).standard ?? null,
          quantity: q,
          unit: item.unit ?? null,
          price: p,
          amount_excl_gst: amount,
          sort_order: i + 1,
        });
      }
      console.log(`[DB] ✅ ${normalizedItems.length} items saved`);
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

    const freight = toNumberOrNull(input.freight) ?? 0;

    const invoiceItems = Array.isArray(input.invoice_items) ? input.invoice_items : [];

    // Compute totals from items when possible (preferred for manual entry)
    const computedSubTotalAbs = invoiceItems.reduce((sum, it) => {
      const q = Math.abs(toNumberOrNull(it.quantity) ?? 0);
      const p = Math.abs(toNumberOrNull(it.price) ?? 0);
      const amt = q * p;
      return sum + amt;
    }, 0);
    const computedSubTotal = Math.round(computedSubTotalAbs * 100) / 100;
    const computedGst = Math.round((computedSubTotal + freight) * 0.15 * 100) / 100;
    const computedTotal = Math.round((computedSubTotal + freight + computedGst) * 100) / 100;

    const totalAmount = toNumberOrNull(input.total_amount) ?? computedTotal;

    const existingId = await checkDuplicate(vendorName, invoiceDate, totalAmount);
    if (existingId) {
      return { success: false, invoiceId: existingId, duplicate: true };
    }

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
        freight,
        toNumberOrNull(input.gst_amount) ?? computedGst,
        totalAmount,
        input.image_url ?? null,
        input.status ?? 'pending_review',
        (input.category ?? null) || deriveCategory(vendorName),
      ]
    );

    const invoiceId: string = invRes.rows[0].id;

    if (invoiceItems.length) {
      for (let i = 0; i < invoiceItems.length; i++) {
        const item = invoiceItems[i];
        const description = item.description?.trim();
        if (!description) continue;

        const quantity = toNumberOrNull(item.quantity);
        const price = toNumberOrNull(item.price);
        const amount = quantity !== null && price !== null ? Math.round(quantity * price * 100) / 100 : toNumberOrNull(item.amount_excl_gst);

        await insertInvoiceItemRow(client, {
          invoice_id: invoiceId,
          product_code: item.product_code ?? null,
          description,
          standard: item.standard ?? null,
          quantity,
          unit: item.unit ?? null,
          price,
          amount_excl_gst: amount,
          sort_order: i + 1,
        });
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

    const invMetaRes = await client.query(
      `SELECT type, total_amount, parent_invoice_id FROM invoices WHERE id=$1`,
      [id]
    );
    const invMeta = (invMetaRes.rows[0] ?? {}) as { type?: string | null; total_amount?: unknown; parent_invoice_id?: string | null };
    const isCreditNote =
      String(invMeta.type ?? '').toLowerCase().includes('credit') ||
      (toNumberOrNull(invMeta.total_amount) ?? 0) < 0 ||
      !!invMeta.parent_invoice_id;

    // If items are provided, recompute totals server-side (manual/edit correctness)
    if (Array.isArray(invoiceItems)) {
      const freightRaw = toNumberOrNull((updates as { freight?: unknown }).freight) ?? 0;
      const subTotalAbs = invoiceItems.reduce((sum, it) => {
        const q = Math.abs(toNumberOrNull(it.quantity) ?? 0);
        const p = Math.abs(toNumberOrNull(it.price) ?? 0);
        return sum + q * p;
      }, 0);

      if (isCreditNote) {
        const subTotal = -Math.round(subTotalAbs * 100) / 100;
        const freight = -Math.abs(freightRaw);
        const gstAmount = Math.round(subTotal * 0.15 * 100) / 100;
        const totalAmount = Math.round((subTotal + freight + gstAmount) * 100) / 100;
        (updates as Record<string, unknown>).sub_total = subTotal;
        (updates as Record<string, unknown>).freight = freight;
        (updates as Record<string, unknown>).gst_amount = gstAmount;
        (updates as Record<string, unknown>).total_amount = totalAmount;
      } else {
        const subTotal = Math.round(subTotalAbs * 100) / 100;
        const gstAmount = Math.round((subTotal + freightRaw) * 0.15 * 100) / 100;
        const totalAmount = Math.round((subTotal + freightRaw + gstAmount) * 100) / 100;
        (updates as Record<string, unknown>).sub_total = subTotal;
        (updates as Record<string, unknown>).freight = freightRaw;
        (updates as Record<string, unknown>).gst_amount = gstAmount;
        (updates as Record<string, unknown>).total_amount = totalAmount;
      }
    }

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
      for (let i = 0; i < invoiceItems.length; i++) {
        const item = invoiceItems[i];
        const description = item.description?.trim();
        if (!description) continue;
        const q0 = toNumberOrNull(item.quantity);
        const p0 = toNumberOrNull(item.price);
        const q = isCreditNote && q0 !== null ? -Math.abs(q0) : q0;
        const p = p0 !== null ? Math.abs(p0) : p0;
        const computed = q !== null && p !== null ? Math.round(q * p * 100) / 100 : toNumberOrNull(item.amount_excl_gst);
        const amount = isCreditNote && computed !== null ? -Math.abs(computed) : computed;
        await insertInvoiceItemRow(client, {
          invoice_id: id,
          product_code: item.product_code ?? null,
          description,
          standard: item.standard ?? null,
          quantity: q,
          unit: item.unit ?? null,
          price: p,
          amount_excl_gst: amount,
          sort_order: i + 1,
        });
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
  from?: string; // YYYY-MM-DD (inclusive)
  to?: string; // YYYY-MM-DD (inclusive)
  limit?: number;
  offset?: number;
}): Promise<{ invoices: Record<string, unknown>[]; total: number }> {
  const { status, search, from, to, limit = 20, offset = 0 } = opts;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (status && status !== 'all') {
    conditions.push(`i.status = $${idx++}`);
    params.push(status);
  }
  if (from) {
    conditions.push(`i.invoice_date >= $${idx++}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`i.invoice_date <= $${idx++}`);
    params.push(to);
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
           ) ORDER BY ii.sort_order NULLS LAST, ii.created_at, ii.id
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
    if (isMissingColumnError(err, 'sort_order')) {
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
             ) ORDER BY ii.created_at, ii.id
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
    } else {
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
  }

  // node-postgres returns NUMERIC as string by default; normalize to numbers for the UI.
  const invoices = dataRes.rows.map((row) => normalizeInvoiceRow(row as Record<string, unknown>));

  return { invoices, total };
}

export type CostReportVendorSummary = {
  vendor_name: string;
  invoice_count: number;
  total_ex_gst: number;
  total_inc_gst: number;
  gst_total: number;
};

export type CostReportProductSummary = {
  product_key: string;
  product_name: string;
  vendor_name: string;
  unit: string | null;
  total_qty: number;
  total_ex_gst: number;
  total_inc_gst: number;
  last_price_ex_gst: number | null;
};

export type CostReportPriceInsight = {
  product_key: string;
  product_name: string;
  vendor_name: string;
  previous_price_ex_gst: number;
  latest_price_ex_gst: number;
  delta: number;
  pct_change: number;
  previous_invoice_date: string;
  latest_invoice_date: string;
};

export type CostReport = {
  vendor_summary: CostReportVendorSummary[];
  product_summary: CostReportProductSummary[];
  price_insights: {
    increased: CostReportPriceInsight[];
    decreased: CostReportPriceInsight[];
  };
};

function buildInvoiceReportWhere(opts: {
  status?: string;
  from?: string;
  to?: string;
  vendor?: string;
  productQ?: string;
}): { whereSql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts.status && opts.status !== 'all') {
    conditions.push(`i.status = $${idx++}`);
    params.push(opts.status);
  }
  if (opts.from) {
    conditions.push(`i.invoice_date >= $${idx++}`);
    params.push(opts.from);
  }
  if (opts.to) {
    conditions.push(`i.invoice_date <= $${idx++}`);
    params.push(opts.to);
  }
  if (opts.vendor) {
    conditions.push(`COALESCE(v.name, i.vendor_name) = $${idx++}`);
    params.push(opts.vendor);
  }
  if (opts.productQ) {
    conditions.push(`(
      COALESCE(rp.name, ii.description, '') ILIKE $${idx}
      OR COALESCE(rp.vendor_product_code, ii.product_code, '') ILIKE $${idx}
    )`);
    params.push(`%${opts.productQ}%`);
    idx++;
  }

  return {
    whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export async function getCostReport(opts: {
  status?: string;
  from?: string;
  to?: string;
  vendor?: string;
  productQ?: string;
  insightLimit?: number;
}): Promise<CostReport> {
  const insightLimit = Math.min(50, Math.max(1, opts.insightLimit ?? 10));
  const { whereSql, params } = buildInvoiceReportWhere(opts);

  const baseFilteredCte = `
    WITH filtered_items AS (
      SELECT
        i.id AS invoice_id,
        i.invoice_date,
        i.created_at AS invoice_created_at,
        i.vendor_id,
        COALESCE(v.name, i.vendor_name) AS vendor_name,
        ii.id AS invoice_item_id,
        ii.created_at AS item_created_at,
        ii.product_id,
        CASE
          WHEN ii.product_id IS NOT NULL THEN ii.product_id::text
          WHEN NULLIF(upper(regexp_replace(COALESCE(ii.product_code, ''), '[^A-Za-z0-9]', '', 'g')), '') IS NOT NULL
            THEN concat(
              'code:',
              COALESCE(i.vendor_id::text, lower(trim(COALESCE(v.name, i.vendor_name)))),
              ':',
              upper(regexp_replace(COALESCE(ii.product_code, ''), '[^A-Za-z0-9]', '', 'g'))
            )
          ELSE concat(
            'desc:',
            COALESCE(i.vendor_id::text, lower(trim(COALESCE(v.name, i.vendor_name)))),
            ':',
            lower(trim(COALESCE(ii.description, '')))
          )
        END AS product_key,
        COALESCE(rp.name, ii.description, 'Unknown item') AS product_name,
        COALESCE(u.code, ii.unit) AS unit,
        COALESCE(ii.quantity, 0) AS quantity,
        COALESCE(
          ii.price,
          CASE
            WHEN COALESCE(ii.quantity, 0) > 0 AND ii.amount_excl_gst IS NOT NULL
              THEN round((ii.amount_excl_gst / ii.quantity)::numeric, 4)
            ELSE NULL
          END
        ) AS price_ex_gst,
        COALESCE(ii.amount_excl_gst, 0) AS amount_ex_gst,
        (
          COALESCE(i.type, '') ILIKE '%credit%'
          OR COALESCE(i.total_amount, 0) < 0
          OR i.parent_invoice_id IS NOT NULL
        ) AS is_credit
      FROM invoices i
      LEFT JOIN vendors v ON v.id = i.vendor_id
      LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
      LEFT JOIN restaurant_products rp ON rp.id = ii.product_id
      LEFT JOIN units u ON u.id = ii.unit_id
      ${whereSql}
    )
  `;

  const vendorRes = await pool.query(
    `${baseFilteredCte}
     SELECT
       vendor_name,
       COUNT(DISTINCT id)::int AS invoice_count,
       COALESCE(SUM(total_ex_gst), 0)::numeric AS total_ex_gst,
       COALESCE(SUM(total_inc_gst), 0)::numeric AS total_inc_gst,
       COALESCE(SUM(gst_total), 0)::numeric AS gst_total
     FROM (
       SELECT DISTINCT
         i.id,
         COALESCE(v.name, i.vendor_name) AS vendor_name,
         COALESCE(i.sub_total, 0) + COALESCE(i.freight, 0) AS total_ex_gst,
         COALESCE(i.total_amount, 0) AS total_inc_gst,
         COALESCE(i.gst_amount, 0) AS gst_total
       FROM invoices i
       LEFT JOIN vendors v ON v.id = i.vendor_id
       LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
       LEFT JOIN restaurant_products rp ON rp.id = ii.product_id
       ${whereSql}
     ) vendor_invoices
     GROUP BY vendor_name
     ORDER BY total_inc_gst DESC, vendor_name ASC`,
    params
  );

  const productRes = await pool.query(
    `${baseFilteredCte}
     , ranked_items AS (
       SELECT
         *,
         ROW_NUMBER() OVER (
           PARTITION BY vendor_name, product_key
           ORDER BY invoice_date DESC NULLS LAST, invoice_created_at DESC, item_created_at DESC, invoice_item_id DESC
         ) AS recency_rank
       FROM filtered_items
       WHERE invoice_item_id IS NOT NULL
     )
     SELECT
       product_key,
       product_name,
       vendor_name,
       unit,
       COALESCE(SUM(quantity), 0)::numeric AS total_qty,
       COALESCE(SUM(amount_ex_gst), 0)::numeric AS total_ex_gst,
       COALESCE(SUM(amount_ex_gst * 1.15), 0)::numeric AS total_inc_gst,
       MAX(price_ex_gst) FILTER (WHERE recency_rank = 1)::numeric AS last_price_ex_gst
     FROM ranked_items
     GROUP BY product_key, product_name, vendor_name, unit
     ORDER BY total_inc_gst DESC, vendor_name ASC, product_name ASC`,
    params
  );

  const insightRes = await pool.query(
    `${baseFilteredCte}
     , price_candidates AS (
       SELECT *
       FROM filtered_items
       WHERE invoice_item_id IS NOT NULL
         AND NOT is_credit
         AND quantity > 0
         AND price_ex_gst IS NOT NULL
         AND price_ex_gst > 0
     )
     , ranked_prices AS (
       SELECT
         *,
         ROW_NUMBER() OVER (
           PARTITION BY vendor_name, product_key
           ORDER BY invoice_date DESC NULLS LAST, invoice_created_at DESC, item_created_at DESC, invoice_item_id DESC
         ) AS recency_rank
       FROM price_candidates
     )
     SELECT
       latest.product_key,
       latest.product_name,
       latest.vendor_name,
       previous.price_ex_gst::numeric AS previous_price_ex_gst,
       latest.price_ex_gst::numeric AS latest_price_ex_gst,
       (latest.price_ex_gst - previous.price_ex_gst)::numeric AS delta,
       CASE
         WHEN previous.price_ex_gst = 0 THEN NULL
         ELSE ((latest.price_ex_gst - previous.price_ex_gst) / previous.price_ex_gst)::numeric
       END AS pct_change,
       previous.invoice_date::text AS previous_invoice_date,
       latest.invoice_date::text AS latest_invoice_date
     FROM ranked_prices latest
     JOIN ranked_prices previous
       ON previous.vendor_name = latest.vendor_name
      AND previous.product_key = latest.product_key
      AND previous.recency_rank = 2
     WHERE latest.recency_rank = 1
       AND previous.price_ex_gst <> latest.price_ex_gst`,
    params
  );

  const vendor_summary = vendorRes.rows.map((row) => ({
    vendor_name: String(row.vendor_name ?? 'Unknown vendor'),
    invoice_count: Number(row.invoice_count ?? 0),
    total_ex_gst: toNumberOrNull(row.total_ex_gst) ?? 0,
    total_inc_gst: toNumberOrNull(row.total_inc_gst) ?? 0,
    gst_total: toNumberOrNull(row.gst_total) ?? 0,
  }));

  const product_summary = productRes.rows.map((row) => ({
    product_key: String(row.product_key ?? ''),
    product_name: String(row.product_name ?? 'Unknown item'),
    vendor_name: String(row.vendor_name ?? 'Unknown vendor'),
    unit: (row.unit as string | null) ?? null,
    total_qty: toNumberOrNull(row.total_qty) ?? 0,
    total_ex_gst: toNumberOrNull(row.total_ex_gst) ?? 0,
    total_inc_gst: toNumberOrNull(row.total_inc_gst) ?? 0,
    last_price_ex_gst: toNumberOrNull(row.last_price_ex_gst),
  }));

  const insightRows = insightRes.rows
    .map((row) => ({
      product_key: String(row.product_key ?? ''),
      product_name: String(row.product_name ?? 'Unknown item'),
      vendor_name: String(row.vendor_name ?? 'Unknown vendor'),
      previous_price_ex_gst: toNumberOrNull(row.previous_price_ex_gst) ?? 0,
      latest_price_ex_gst: toNumberOrNull(row.latest_price_ex_gst) ?? 0,
      delta: toNumberOrNull(row.delta) ?? 0,
      pct_change: toNumberOrNull(row.pct_change) ?? 0,
      previous_invoice_date: String(row.previous_invoice_date ?? ''),
      latest_invoice_date: String(row.latest_invoice_date ?? ''),
    }))
    .filter((row) => Number.isFinite(row.pct_change));

  return {
    vendor_summary,
    product_summary,
    price_insights: {
      increased: insightRows
        .filter((row) => row.delta > 0)
        .sort((a, b) => b.pct_change - a.pct_change)
        .slice(0, insightLimit),
      decreased: insightRows
        .filter((row) => row.delta < 0)
        .sort((a, b) => a.pct_change - b.pct_change)
        .slice(0, insightLimit),
    },
  };
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

export type CreateCreditNoteInput = {
  source_invoice_id: string;
  credit_note_number?: string | null;
  credit_note_date?: string | null; // YYYY-MM-DD
  items: Array<{
    source_item_id: string;
    quantity: number | string; // positive number from UI
    amount_excl_gst?: number | string | null; // positive number from UI (optional)
    price?: number | string | null; // positive number from UI (optional)
  }>;
};

export async function createCreditNoteFromInvoice(input: CreateCreditNoteInput): Promise<SaveResult> {
  const client = await pool.connect();

  try {
    const sourceInvoiceId = input.source_invoice_id;
    if (!sourceInvoiceId) return { success: false, error: 'source_invoice_id is required' };
    if (!Array.isArray(input.items) || input.items.length === 0) return { success: false, error: 'items is required' };

    const srcInvRes = await client.query(
      `SELECT * FROM invoices WHERE id=$1`,
      [sourceInvoiceId]
    );
    const srcInvoice = srcInvRes.rows[0] as Record<string, unknown> | undefined;
    if (!srcInvoice) return { success: false, error: 'Source invoice not found' };

    const srcType = String(srcInvoice.type ?? '');
    const srcTotal = toNumberOrNull(srcInvoice.total_amount) ?? 0;
    const srcParent = srcInvoice.parent_invoice_id as string | null | undefined;
    const srcIsCredit =
      srcType.toLowerCase().includes('credit') ||
      srcTotal < 0 ||
      !!srcParent;
    if (srcIsCredit) {
      return { success: false, error: 'Cannot create a Credit Note from an existing Credit Note' };
    }

    const ids = input.items.map((it) => it.source_item_id).filter(Boolean);
    const srcItemsRes = await client.query(
      `SELECT * FROM invoice_items WHERE invoice_id=$1 AND id = ANY($2::uuid[])`,
      [sourceInvoiceId, ids]
    );
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of srcItemsRes.rows as Record<string, unknown>[]) {
      byId.set(String(row.id), row);
    }

    const normalizedItems = input.items
      .map((it) => {
        const row = byId.get(it.source_item_id);
        if (!row) return null;

        const qty = toNumberOrNull(it.quantity);
        if (qty === null || qty <= 0) return null;

        const price = toNumberOrNull(it.price) ?? toNumberOrNull(row.price) ?? 0;
        // For manual credit notes: amount is always derived from qty * price
        const amount = round2(qty * price);

        return {
          product_code: (row.product_code as string | null) ?? null,
          description: String(row.description ?? '').trim(),
          standard: (row.standard as string | null) ?? null,
          unit: (row.unit as string | null) ?? null,
          quantity: -Math.abs(qty),
          price: Math.abs(price),
          amount_excl_gst: -Math.abs(amount),
        };
      })
      .filter(Boolean) as Array<{
        product_code: string | null;
        description: string;
        standard: string | null;
        unit: string | null;
        quantity: number;
        price: number;
        amount_excl_gst: number;
      }>;

    if (normalizedItems.length === 0) {
      return { success: false, error: 'No valid items to credit' };
    }

    const subTotalAbs = normalizedItems.reduce((s, it) => s + Math.abs(it.amount_excl_gst), 0);
    const subTotal = -round2(subTotalAbs);
    const freight = 0;
    const gstAmount = round2(subTotal * 0.15);
    const totalAmount = round2(subTotal + freight + gstAmount);

    const creditNoteDate =
      (input.credit_note_date && String(input.credit_note_date).slice(0, 10)) ||
      new Date().toISOString().slice(0, 10);

    const generatedNumber = `CN-${String(sourceInvoiceId).slice(0, 8)}-${Date.now()}`;
    const creditNoteNumber = (input.credit_note_number ?? '').trim() || generatedNumber;

    await client.query('BEGIN');

    const invIns = await client.query(
      `INSERT INTO invoices
        (type, vendor_name, vendor_address, vendor_gst_number, invoice_number,
         invoice_date, currency, is_tax_invoice, billing_name, billing_address,
         sub_total, freight, gst_amount, total_amount, image_url, status, category, parent_invoice_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        'Credit Note',
        srcInvoice.vendor_name,
        srcInvoice.vendor_address ?? null,
        srcInvoice.vendor_gst_number ?? null,
        creditNoteNumber,
        creditNoteDate,
        srcInvoice.currency ?? 'NZD',
        true,
        srcInvoice.billing_name ?? null,
        srcInvoice.billing_address ?? null,
        subTotal,
        freight,
        gstAmount,
        totalAmount,
        null,
        'pending_review',
        srcInvoice.category ?? null,
        sourceInvoiceId,
      ]
    );

    const newInvoiceId = String(invIns.rows[0].id);

    for (let i = 0; i < normalizedItems.length; i++) {
      const item = normalizedItems[i];
      await insertInvoiceItemRow(client, {
        invoice_id: newInvoiceId,
        product_code: item.product_code,
        description: item.description,
        standard: item.standard,
        quantity: toNumberOrNull(item.quantity),
        unit: item.unit,
        price: toNumberOrNull(item.price),
        amount_excl_gst: toNumberOrNull(item.amount_excl_gst),
        sort_order: i + 1,
      });
    }

    await client.query('COMMIT');
    return { success: true, invoiceId: newInvoiceId };
  } catch (err) {
    await client.query('ROLLBACK');
    return { success: false, error: (err as Error).message };
  } finally {
    client.release();
  }
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

export type VendorSettingsRow = {
  id: string;
  name: string;
  gst_number: string | null;
  prices_include_gst: boolean;
};

export async function createVendor(input: {
  name: string;
  gst_number?: string | null;
  address?: string | null;
  prices_include_gst?: boolean;
}): Promise<VendorSettingsRow> {
  const name = input.name.trim();
  if (!name) throw new Error('name is required');

  try {
    const res = await pool.query(
      `INSERT INTO vendors (name, gst_number, address, prices_include_gst, created_at, updated_at)
       VALUES ($1,$2,$3,$4,NOW(),NOW())
       ON CONFLICT (name) DO UPDATE
         SET gst_number = COALESCE(EXCLUDED.gst_number, vendors.gst_number),
             address = COALESCE(EXCLUDED.address, vendors.address),
             prices_include_gst = COALESCE(EXCLUDED.prices_include_gst, vendors.prices_include_gst),
             updated_at = NOW()
       RETURNING id, name, gst_number, COALESCE(prices_include_gst,false) AS prices_include_gst`,
      [
        name,
        input.gst_number ?? null,
        input.address ?? null,
        typeof input.prices_include_gst === 'boolean' ? input.prices_include_gst : false,
      ]
    );
    return res.rows[0] as VendorSettingsRow;
  } catch (err) {
    if (isMissingColumnError(err, 'prices_include_gst')) {
      const res = await pool.query(
        `INSERT INTO vendors (name, gst_number, address, created_at, updated_at)
         VALUES ($1,$2,$3,NOW(),NOW())
         ON CONFLICT (name) DO UPDATE
           SET gst_number = COALESCE(EXCLUDED.gst_number, vendors.gst_number),
               address = COALESCE(EXCLUDED.address, vendors.address),
               updated_at = NOW()
         RETURNING id, name, gst_number, false AS prices_include_gst`,
        [name, input.gst_number ?? null, input.address ?? null]
      );
      return res.rows[0] as VendorSettingsRow;
    }
    throw err;
  }
}

export async function deleteVendorById(vendorId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inInvoices = await client.query(`SELECT 1 FROM invoices WHERE vendor_id=$1 LIMIT 1`, [vendorId]);
    if (inInvoices.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'Vendor is in use (invoices).' };
    }

    try {
      const inProducts = await client.query(`SELECT 1 FROM restaurant_products WHERE vendor_id=$1 LIMIT 1`, [vendorId]);
      if (inProducts.rows.length) {
        await client.query('ROLLBACK');
        return { ok: false, status: 409, error: 'Vendor is in use (products).' };
      }
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }

    const del = await client.query(`DELETE FROM vendors WHERE id=$1`, [vendorId]);
    await client.query('COMMIT');
    if ((del.rowCount ?? 0) === 0) return { ok: false, status: 404, error: 'Vendor not found' };
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, status: 500, error: (err as Error).message };
  } finally {
    client.release();
  }
}

export type OrphanCleanupResult = {
  deleted_restaurant_products: number;
  deleted_units: number;
  deleted_standards: number;
  deleted_vendors: number;
};

export async function cleanupOrphanCatalog(): Promise<OrphanCleanupResult> {
  const client = await pool.connect();
  const result: OrphanCleanupResult = {
    deleted_restaurant_products: 0,
    deleted_units: 0,
    deleted_standards: 0,
    deleted_vendors: 0,
  };

  try {
    await client.query('BEGIN');

    // Restaurant products: not referenced by any invoice_items.product_id
    try {
      const del = await client.query(
        `DELETE FROM public.restaurant_products rp
         WHERE NOT EXISTS (
           SELECT 1 FROM public.invoice_items ii WHERE ii.product_id = rp.id
         )`
      );
      result.deleted_restaurant_products = del.rowCount ?? 0;
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }

    // Units: not referenced by invoice_items.unit_id nor restaurant_products.unit_id
    try {
      const del = await client.query(
        `DELETE FROM public.units u
         WHERE NOT EXISTS (SELECT 1 FROM public.invoice_items ii WHERE ii.unit_id = u.id)
           AND NOT EXISTS (SELECT 1 FROM public.restaurant_products rp WHERE rp.unit_id = u.id)`
      );
      result.deleted_units = del.rowCount ?? 0;
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }

    // Standards: not referenced by invoice_items.standard_id nor restaurant_products.standard_id
    try {
      const del = await client.query(
        `DELETE FROM public.standards s
         WHERE NOT EXISTS (SELECT 1 FROM public.invoice_items ii WHERE ii.standard_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM public.restaurant_products rp WHERE rp.standard_id = s.id)`
      );
      result.deleted_standards = del.rowCount ?? 0;
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }

    // Vendors: not referenced by invoices.vendor_id and not referenced by restaurant_products.vendor_id
    try {
      const del = await client.query(
        `DELETE FROM public.vendors v
         WHERE NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.vendor_id = v.id)
           AND NOT EXISTS (SELECT 1 FROM public.restaurant_products rp WHERE rp.vendor_id = v.id)`
      );
      result.deleted_vendors = del.rowCount ?? 0;
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listVendorSettings(limit = 500): Promise<VendorSettingsRow[]> {
  try {
    const res = await pool.query(
      `SELECT id, name, gst_number,
              COALESCE(prices_include_gst, false) AS prices_include_gst
         FROM vendors
        ORDER BY name ASC
        LIMIT $1`,
      [limit]
    );
    return res.rows as VendorSettingsRow[];
  } catch (err) {
    if (isMissingTableError(err)) return [];
    if (isMissingColumnError(err, 'prices_include_gst')) {
      const res = await pool.query(
        `SELECT id, name, gst_number, false AS prices_include_gst
           FROM vendors
          ORDER BY name ASC
          LIMIT $1`,
        [limit]
      );
      return res.rows as VendorSettingsRow[];
    }
    throw err;
  }
}

export async function updateVendorPricesIncludeGst(vendorId: string, value: boolean): Promise<boolean> {
  try {
    await pool.query(
      `UPDATE vendors SET prices_include_gst=$2, updated_at=NOW() WHERE id=$1`,
      [vendorId, value]
    );
    return true;
  } catch (err) {
    if (isMissingColumnError(err, 'prices_include_gst')) {
      throw new Error('DB is missing vendors.prices_include_gst. Run the migration first.');
    }
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

export type ProductSuggestion = {
  restaurant_product_id: string;
  name: string;
  vendor_product_code: string | null;
  unit: string | null;
  standard: string | null;
};

export async function listProducts(opts: {
  vendorName?: string;
  q?: string;
  limit?: number;
}): Promise<ProductSuggestion[]> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  const q = (opts.q ?? '').trim();
  const vendorName = (opts.vendorName ?? '').trim();

  try {
    const params: unknown[] = [];
    let idx = 1;

    // Optional vendor filter by name -> vendor id
    let vendorFilter = '';
    if (vendorName) {
      params.push(vendorName);
      vendorFilter = `WHERE v.name = $${idx++}`;
    }

    const vendorRes = vendorName
      ? await pool.query(`SELECT id FROM vendors v ${vendorFilter} LIMIT 1`, params)
      : { rows: [] as Array<{ id: string }> };

    const vendorId = vendorRes.rows[0]?.id ?? null;

    const where: string[] = [];
    const p: unknown[] = [];
    let j = 1;

    if (vendorId) {
      where.push(`rp.vendor_id = $${j++}`);
      p.push(vendorId);
    }
    if (q) {
      where.push(`rp.name ILIKE $${j++}`);
      p.push(`%${q}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const res = await pool.query(
      `SELECT rp.restaurant_product_id,
              rp.name,
              rp.vendor_product_code,
              u.code AS unit,
              s.value AS standard
       FROM restaurant_products rp
       LEFT JOIN units u ON u.id = rp.unit_id
       LEFT JOIN standards s ON s.id = rp.standard_id
       ${whereSql}
       ORDER BY rp.updated_at DESC NULLS LAST, rp.created_at DESC
       LIMIT $${j}`,
      [...p, limit]
    );

    return res.rows.map((r) => ({
      restaurant_product_id: r.restaurant_product_id as string,
      name: r.name as string,
      vendor_product_code: (r.vendor_product_code as string | null) ?? null,
      unit: (r.unit as string | null) ?? null,
      standard: (r.standard as string | null) ?? null,
    }));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}
