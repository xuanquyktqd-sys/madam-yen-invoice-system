/**
 * OCR Service — Madam Yen IMS
 * Skill: ORC vision/Skill.md + ocr-system-prompt.md
 *
 * Rules:
 *  - Default provider: DeepInfra (OpenAI-compatible) using Gemini 2.5 Flash
 *  - Optional fallback: Google Gemini (OpenAI-compatible endpoint)
 *  - Output: Strict JSON matching invoice-sample.json schema
 *  - Financial: GST = 15% NZ; always validate subtotal + gst = total
 */

import OpenAI from 'openai';

// ─── Types matching invoice-sample.json ───────────────────────────────────────
export type LineItem = {
  raw_row_text: string;
  product_code: string | null;
  description: string;
  standard?: string | null;
  quantity: number | null;
  unit: string | null;
  price: number | null;
  amount_excl_gst?: number;
};

export type InvoiceData = {
  invoice_metadata: {
    vendor_name: string;
    vendor_gst_number: string | null;
    invoice_number: string | null;
    date: string;          // YYYY-MM-DD
  };
  line_items: LineItem[];
};

// ─── Prompt ───────────────────────────────────────────────────────────────────
const OCR_SYSTEM_PROMPT = `You are an OCR extraction system for New Zealand restaurant invoices.
Your goal is to extract ONLY these fields with maximum accuracy (no extra fields):

### OUTPUT JSON (strict):
Return ONLY a raw JSON object matching this exact schema:
{
  "invoice_metadata": {
    "vendor_name": "string",
    "vendor_gst_number": "string or null",
    "invoice_number": "string or null",
    "date": "YYYY-MM-DD"
  },
  "line_items": [
    {
      "raw_row_text": "string",
      "product_code": "string or null",
      "description": "string",
      "quantity": number or null,
      "unit": "string or null",
      "price": number or null
    }
  ]
}

### LINE ITEMS RULES (IMPORTANT):
- The line_items section is a TABLE.
- Extract rows TOP to BOTTOM.
- Preserve row order exactly as printed.
- Do NOT skip rows.
- Do NOT merge multiple rows into one.
- Do NOT split one row into multiple rows.
- Keep units and decimals EXACTLY as shown (do not round, do not normalize).
- Return null ONLY for unclear CELLS, not for the whole row.
- Always return a row object for each table row, even if some cells are null.

### OUTPUT RULES:
- Return STRICT JSON ONLY. No markdown, no code fences, no explanation.`;

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
// Totals are intentionally NOT extracted by OCR.

// ─── OCR Engine (OpenAI-compatible) ──────────────────────────────────────────
type OcrProvider = 'deepinfra' | 'gemini';

type ProviderConfig = {
  name: OcrProvider;
  baseURL: string;
  apiKey: string | undefined;
  model: string;
};

const PRIMARY: ProviderConfig = {
  name: 'deepinfra',
  baseURL: 'https://api.deepinfra.com/v1/openai',
  apiKey: process.env.DEEPINFRA_API_KEY ?? process.env.OPENAI_API_KEY,
  // DeepInfra model ids vary by account/region; override with OCR_MODEL_PRIMARY when needed.
  model: process.env.OCR_MODEL_PRIMARY ?? 'google/gemini-2.5-flash',
};

const FALLBACK: ProviderConfig = {
  name: 'gemini',
  // Google Gemini OpenAI-compatible endpoint.
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  apiKey: process.env.GEMINI_API_KEY ?? process.env.OPENAI_API_KEY,
  model: process.env.GEMINI_MODEL_PRIMARY ?? 'gemini-2.5-flash',
};

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
    // Gemini's OpenAI-compatible API can be configured to accept x-goog-api-key.
    defaultHeaders: cfg.name === 'gemini' ? { 'x-goog-api-key': cfg.apiKey } : undefined,
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
          { type: 'text', text: 'Extract invoice metadata and the line items table (top-to-bottom). Return strict JSON only.' },
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

  return parsed;
}

export type OcrRunMeta = {
  provider: OcrProvider;
  model: string;
  fallbackUsed: boolean;
};

/**
 * Main OCR function with automatic failover:
 *  - Uses OpenAI SDK with an OpenAI-compatible baseURL.
 *  - Primary: DeepInfra (Gemini 2.5 Flash).
 *  - Fallback: Gemini 2.5 Flash (OpenAI-compatible endpoint)
 */
export async function extractInvoiceData(imageBuffer: Buffer): Promise<{ data: InvoiceData; meta: OcrRunMeta }> {
  const TIMEOUT_MS = Math.max(8_000, Math.min(25_000, Number(process.env.OCR_REQUEST_TIMEOUT_MS ?? 18_000)));
  const PRIMARY_ATTEMPTS = Math.max(1, Math.min(2, Number(process.env.OCR_PRIMARY_ATTEMPTS ?? 1)));
  const FALLBACK_ATTEMPTS = Math.max(1, Math.min(2, Number(process.env.OCR_FALLBACK_ATTEMPTS ?? 1)));

  const force = (process.env.OCR_FORCE_PROVIDER ?? '').toLowerCase();
  const providers: Array<{ cfg: ProviderConfig; attempts: number }> =
    force === 'gemini'
      ? [{ cfg: FALLBACK, attempts: FALLBACK_ATTEMPTS }]
      : force === 'deepinfra'
        ? [{ cfg: PRIMARY, attempts: PRIMARY_ATTEMPTS }]
        : [
            { cfg: PRIMARY, attempts: PRIMARY_ATTEMPTS },
            { cfg: FALLBACK, attempts: FALLBACK_ATTEMPTS },
          ];

  console.log(
    `[OCR] Plan: primary=${PRIMARY.name}/${PRIMARY.model} (x${PRIMARY_ATTEMPTS}), fallback=${FALLBACK.name}/${FALLBACK.model} (x${FALLBACK_ATTEMPTS})`
  );

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

  const isModelNotFound = (err: unknown): boolean => {
    const status = getHttpStatus(err);
    if (status === 404) return true;
    const msg = String((err as { message?: unknown } | null)?.message ?? '').toLowerCase();
    return msg.includes('does not exist') || msg.includes('model') && msg.includes('not found');
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

  const callWithRetry = async (cfg: ProviderConfig, attempts: number): Promise<InvoiceData> => {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        if (attempt > 1) console.log(`[OCR] Retry ${attempt}/${attempts} — ${cfg.name}/${cfg.model}`);
        return await withTimeout(callOpenAICompatible(imageBuffer, cfg), TIMEOUT_MS);
      } catch (err) {
        lastErr = err;
        if ((err as Error)?.message === 'OCR_TIMEOUT') {
          throw new Error(`OCR_TIMEOUT_${TIMEOUT_MS}`);
        }
        if (isModelNotFound(err)) break;
        if (!isRetryableError(err) || attempt === attempts) break;
        const base = 600 * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 250);
        await sleep(Math.min(8_000, base + jitter));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };

  let lastProviderError: unknown = null;
  let fallbackUsed = false;

  const configuredModel = (process.env.OCR_MODEL_PRIMARY ?? '').trim();
  const primaryModelCandidates = configuredModel
    ? [configuredModel]
    : ['google/gemini-2.5-flash'];

  for (let providerIndex = 0; providerIndex < providers.length; providerIndex++) {
    const { cfg: baseCfg, attempts } = providers[providerIndex]!;
    const isPrimary = baseCfg.name === PRIMARY.name;
    const candidates = isPrimary ? primaryModelCandidates : [baseCfg.model];
    if (providerIndex > 0) fallbackUsed = true;

    for (const model of candidates) {
      const cfg: ProviderConfig = { ...baseCfg, model };
      try {
        const data = await callWithRetry(cfg, attempts);
        console.log(`[OCR] ✅ ${cfg.name}/${cfg.model} succeeded`);
        return { data, meta: { provider: cfg.name, model: cfg.model, fallbackUsed } };
      } catch (err) {
        lastProviderError = err;
        if (isPrimary && isModelNotFound(err) && !configuredModel) {
          console.error(`[OCR] ❌ Model not found: ${cfg.model} (trying next candidate)`);
          continue;
        }
        console.error(`[OCR] ❌ ${cfg.name}/${cfg.model} failed after retries.`, err);
        break;
      }
    }
  }

  const err = lastProviderError as Error;
  const msg = err?.message || 'Unknown error';
  const status = getHttpStatus(lastProviderError);
  if (status === 503 || msg.includes('high demand')) {
    throw new Error('MODEL_HIGH_DEMAND');
  }
  if (msg.includes('OCR_BAD_JSON') || msg.includes('Unexpected token')) {
    throw new Error('OCR_OUTPUT_INVALID');
  }
  throw new Error(`OCR failed: ${msg}`);
}
