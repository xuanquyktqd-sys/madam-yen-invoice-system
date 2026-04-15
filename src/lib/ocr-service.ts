/**
 * OCR Service — Madam Yen IMS
 * Skill: ORC vision/Skill.md + ocr-system-prompt.md
 *
 * Rules:
 *  - Primary: gemini-2.5-pro (highest accuracy for NZ invoice OCR)
 *  - Failover: gemini-2.5-flash (fast, confirmed available)
 *  - Output: Strict JSON matching invoice-sample.json schema
 *  - Financial: GST = 15% NZ; always validate subtotal + gst = total
 */

import { GoogleGenerativeAI, Part } from '@google/generative-ai';

// ─── Types matching invoice-sample.json ───────────────────────────────────────
export type LineItem = {
  product_code: string | null;
  description: string;
  standard: string | null;
  quantity: number;
  unit: string | null;
  price: number;
  amount_excl_gst: number;
};

export type InvoiceData = {
  invoice_metadata: {
    type: string;
    vendor_name: string;
    vendor_address: string | null;
    vendor_gst_number: string | null;
    invoice_number: string | null;
    date: string;          // YYYY-MM-DD
    currency: string;
    is_tax_invoice: boolean;
    status: string;
  };
  billing_info: {
    billing_name: string | null;
    billing_address: string | null;
  };
  line_items: LineItem[];
  totals: {
    sub_total: number;
    freight: number;
    gst_amount: number;
    total_amount: number;
    calculation_error?: boolean;
  };
};

// ─── Prompt ───────────────────────────────────────────────────────────────────
const OCR_SYSTEM_PROMPT = `Act as an expert OCR system specializing in New Zealand restaurant invoices (Tax Invoices).
Your goal is to extract data with 100% numerical accuracy.

### OUTPUT STRUCTURE:
Return ONLY a raw JSON object matching this exact schema (from invoice-sample.json ground truth):
{
  "invoice_metadata": {
    "type": "Tax Invoice",
    "vendor_name": "string",
    "vendor_address": "string or null",
    "vendor_gst_number": "string or null",
    "invoice_number": "string or null",
    "date": "YYYY-MM-DD",
    "currency": "NZD",
    "is_tax_invoice": true,
    "status": "pending_review"
  },
  "billing_info": {
    "billing_name": "string or null",
    "billing_address": "string or null"
  },
  "line_items": [
    {
      "product_code": "string or null",
      "description": "string",
      "standard": "string or null",
      "quantity": number,
      "unit": "string or null",
      "price": number,
      "amount_excl_gst": number
    }
  ],
  "totals": {
    "sub_total": number,
    "freight": number,
    "gst_amount": number,
    "total_amount": number
  }
}

### CRITICAL RULES:
1. **GST Validation (NZ Standard 15%):**
   - If GST not explicitly stated: gst_amount = total_amount - (total_amount / 1.15)
   - Always verify: sub_total + gst_amount = total_amount. If difference > 0.01, add "calculation_error": true to totals.
2. **Quantity Precision:** Keep ALL decimals (e.g. 4.555 for meat/produce). NEVER round.
3. **Data Integrity:**
   - Blurry or missing field: return null for that field.
   - If document is a Quote or Order Confirmation (NOT a Tax Invoice): set is_tax_invoice: false.
4. **Formatting:** Return STRICT JSON ONLY. No preamble. No markdown. No explanation.`;

// ─── Vendor Category Mapping ───────────────────────────────────────────────
export function deriveCategory(vendorName: string): string {
  const name = vendorName.toLowerCase();
  if (name.includes('tokyo') || name.includes('gilmours') || name.includes('bidfood') || name.includes('food')) return 'Food';
  if (name.includes('southern hospitality') || name.includes('equipment')) return 'Equipment';
  if (name.includes('liquor') || name.includes('beer') || name.includes('wine')) return 'Beverages';
  if (name.includes('cleaning') || name.includes('hygiene')) return 'Cleaning';
  return 'Other';
}

// ─── Financial Validation ──────────────────────────────────────────────────
export function validateFinancials(totals: InvoiceData['totals']): InvoiceData['totals'] {
  const { sub_total, freight, gst_amount, total_amount } = totals;
  const expected = Math.round((sub_total + (freight ?? 0) + gst_amount) * 100) / 100;
  const diff = Math.abs(expected - total_amount);

  if (diff > 0.01) {
    console.warn(`[CALCULATION_ERROR] Expected ${expected}, got ${total_amount} (diff: ${diff.toFixed(4)})`);
    return { ...totals, calculation_error: true };
  }
  return totals;
}

// ─── OCR Engine ───────────────────────────────────────────────────────────────
async function callGemini(imageBuffer: Buffer, modelName: string): Promise<InvoiceData> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const imagePart: Part = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType: 'image/jpeg',
    },
  };

  const result = await model.generateContent([OCR_SYSTEM_PROMPT, imagePart]);
  const text = result.response.text().trim();

  // Strip markdown code fences if Gemini adds them despite instructions
  const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  const parsed: InvoiceData = JSON.parse(jsonText);

  // Validate financials
  parsed.totals = validateFinancials(parsed.totals);

  return parsed;
}

/**
 * Main OCR function with automatic failover:
 *  1. Try gemini-2.5-pro (best OCR accuracy for NZ invoices)
 *  2. On timeout/error → fallback to gemini-2.5-flash (fast + accurate)
 */
export async function extractInvoiceData(imageBuffer: Buffer): Promise<InvoiceData> {
  const PRIMARY_MODEL = process.env.GEMINI_MODEL_PRIMARY ?? 'gemini-2.5-pro';
  const FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK ?? 'gemini-2.5-flash';
  const TIMEOUT_MS = 50_000;
  const MAX_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.GEMINI_RETRY_ATTEMPTS ?? 3)));

  console.log(`[OCR] Trying ${PRIMARY_MODEL}...`);

  const withTimeout = (promise: Promise<InvoiceData>, ms: number): Promise<InvoiceData> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('OCR_TIMEOUT')), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const getHttpStatus = (err: unknown): number | null => {
    const e = err as { status?: unknown; response?: { status?: unknown }; cause?: { status?: unknown }; message?: unknown } | null;
    const direct = e?.status ?? e?.response?.status ?? e?.cause?.status;
    if (typeof direct === 'number') return direct;
    if (typeof direct === 'string') {
      const n = Number(direct);
      if (Number.isFinite(n)) return n;
    }
    const msg = String(e?.message ?? '');
    const m = msg.match(/\[(\d{3})\s+[A-Za-z]/);
    if (m?.[1]) return Number(m[1]);
    return null;
  };

  const isRetryableError = (err: unknown): boolean => {
    const status = getHttpStatus(err);
    if (status && (status === 429 || status === 500 || status === 502 || status === 503 || status === 504)) return true;
    const msg = String((err as { message?: unknown } | null)?.message ?? '');
    return (
      msg.includes('high demand') ||
      msg.includes('Service Unavailable') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('fetch failed')
    );
  };

  const callWithRetry = async (modelName: string): Promise<InvoiceData> => {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) console.log(`[OCR] Retry ${attempt}/${MAX_ATTEMPTS} — ${modelName}`);
        return await withTimeout(callGemini(imageBuffer, modelName), TIMEOUT_MS);
      } catch (err) {
        lastErr = err;
        if (!isRetryableError(err) || attempt === MAX_ATTEMPTS) break;
        const base = 600 * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 250);
        await sleep(Math.min(8_000, base + jitter));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };

  try {
    const result = await callWithRetry(PRIMARY_MODEL);
    console.log(`[OCR] ✅ ${PRIMARY_MODEL} succeeded`);
    return result;
  } catch (primaryError) {
    const err = primaryError as Error;
    console.warn(`[OCR] ⚠️ ${PRIMARY_MODEL} failed (${err.message}). Falling back to ${FALLBACK_MODEL}...`);

    try {
      const fallbackResult = await callWithRetry(FALLBACK_MODEL);
      console.log(`[OCR] ✅ ${FALLBACK_MODEL} fallback succeeded`);
      return fallbackResult;
    } catch (fallbackError) {
      console.error(`[OCR] ❌ Both models failed.`, fallbackError);
      const msg = (fallbackError as Error).message || 'Unknown error';
      const status = getHttpStatus(fallbackError);
      if (status === 503 || msg.includes('high demand')) {
        throw new Error('MODEL_HIGH_DEMAND');
      }
      throw new Error(`OCR failed: ${msg}`);
    }
  }
}
