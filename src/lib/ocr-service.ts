/**
 * OCR Service — Madam Yen IMS
 * Skill: ORC vision/Skill.md + ocr-system-prompt.md
 *
 * Rules:
 *  - Default provider: DeepInfra (OpenAI-compatible) using Llama 4 Scout
 *  - Optional fallback: Google Gemini (OpenAI-compatible endpoint)
 *  - Output: Strict JSON matching invoice-sample.json schema
 *  - Financial: GST = 15% NZ; always validate subtotal + gst = total
 */

import OpenAI from 'openai';

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

// ─── OCR Engine (OpenAI-compatible) ──────────────────────────────────────────
type OcrProvider = 'deepinfra' | 'gemini';

type ProviderConfig = {
  name: OcrProvider;
  baseURL: string;
  apiKey: string | undefined;
  model: string;
};

function getProviderConfig(): ProviderConfig {
  const provider = (process.env.OCR_AI_PROVIDER ?? 'deepinfra') as OcrProvider;

  const deepinfra: ProviderConfig = {
    name: 'deepinfra',
    baseURL: process.env.OCR_OPENAI_BASE_URL ?? 'https://api.deepinfra.com/v1/openai',
    apiKey: process.env.DEEPINFRA_API_KEY ?? process.env.OPENAI_API_KEY,
    // DeepInfra model ids vary by account/region; override with OCR_MODEL_PRIMARY when needed.
    model: process.env.OCR_MODEL_PRIMARY ?? 'meta-llama/llama-4-scout-17b-16e-instruct',
  };

  const gemini: ProviderConfig = {
    name: 'gemini',
    // Google Gemini OpenAI-compatible endpoint.
    baseURL: process.env.OCR_OPENAI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKey: process.env.GEMINI_API_KEY ?? process.env.OPENAI_API_KEY,
    model: process.env.GEMINI_MODEL_PRIMARY ?? process.env.OCR_MODEL_PRIMARY ?? 'gemini-2.5-flash',
  };

  if (provider === 'gemini') return gemini;
  return deepinfra;
}

function getTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (!p) return '';
        if (typeof p === 'string') return p;
        const text = (p as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      })
      .join('')
      .trim();
  }
  return '';
}

async function callOpenAICompatible(imageBuffer: Buffer, cfg: ProviderConfig): Promise<InvoiceData> {
  if (!cfg.apiKey) throw new Error('OCR_API_KEY_MISSING');

  const openai = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
  });

  const b64 = imageBuffer.toString('base64');
  const dataUrl = `data:image/jpeg;base64,${b64}`;

  const completion = await openai.chat.completions.create({
    model: cfg.model,
    temperature: 0,
    messages: [
      { role: 'system', content: OCR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract invoice data from this image.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const msg = completion.choices?.[0]?.message;
  const text = getTextContent(msg?.content).trim();

  // Strip markdown code fences if provider adds them despite instructions
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  const tryParse = (input: string): InvoiceData => JSON.parse(input) as InvoiceData;

  let parsed: InvoiceData | null = null;
  try {
    parsed = tryParse(cleaned);
  } catch {
    // Salvage when model wraps JSON with extra text (or returns a plain error string)
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) {
      const sliced = cleaned.slice(first, last + 1);
      try {
        parsed = tryParse(sliced);
      } catch {
        // fall through
      }
    }
  }

  if (!parsed) {
    throw new Error('OCR_BAD_JSON');
  }

  parsed.totals = validateFinancials(parsed.totals);
  return parsed;
}

/**
 * Main OCR function with automatic failover:
 *  - Uses OpenAI SDK with an OpenAI-compatible baseURL.
 *  - Default: DeepInfra (Llama 4 Scout).
 *  - Optional: Gemini via Google's OpenAI-compatible endpoint (set OCR_AI_PROVIDER=gemini).
 */
export async function extractInvoiceData(imageBuffer: Buffer): Promise<InvoiceData> {
  const cfg = getProviderConfig();
  const TIMEOUT_MS = 50_000;
  const MAX_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.OCR_RETRY_ATTEMPTS ?? 3)));

  console.log(`[OCR] Provider=${cfg.name} Model=${cfg.model}`);

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
      msg.includes('OCR_BAD_JSON') ||
      msg.includes('Unexpected token') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('fetch failed')
    );
  };

  const callWithRetry = async (modelName: string): Promise<InvoiceData> => {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) console.log(`[OCR] Retry ${attempt}/${MAX_ATTEMPTS} — ${cfg.name}/${modelName}`);
        return await withTimeout(callOpenAICompatible(imageBuffer, { ...cfg, model: modelName }), TIMEOUT_MS);
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
    const result = await callWithRetry(cfg.model);
    console.log(`[OCR] ✅ ${cfg.name}/${cfg.model} succeeded`);
    return result;
  } catch (primaryError) {
    const err = primaryError as Error;
    console.error(`[OCR] ❌ ${cfg.name}/${cfg.model} failed after retries.`, err);
    const msg = err.message || 'Unknown error';
    const status = getHttpStatus(primaryError);
    if (status === 503 || msg.includes('high demand')) {
      throw new Error('MODEL_HIGH_DEMAND');
    }
    if (msg.includes('OCR_BAD_JSON') || msg.includes('Unexpected token')) {
      throw new Error('OCR_OUTPUT_INVALID');
    }
    throw new Error(`OCR failed: ${msg}`);
  }
}
