// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

type InvoiceData = {
  invoice_metadata: {
    type: string;
    vendor_name: string;
    vendor_address: string | null;
    vendor_gst_number: string | null;
    invoice_number: string | null;
    date: string;
    currency: string;
    is_tax_invoice: boolean;
    status: string;
  };
  billing_info: {
    billing_name: string | null;
    billing_address: string | null;
  };
  line_items: Array<{
    product_code: string | null;
    description: string;
    standard: string | null;
    quantity: number;
    unit: string | null;
    price: number;
    amount_excl_gst: number;
  }>;
  totals: {
    sub_total: number;
    freight: number;
    gst_amount: number;
    total_amount: number;
    calculation_error?: boolean;
  };
};

type ClaimedJob = {
  id: string;
  status: string;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  attempts: number;
  max_attempts: number;
};

const OCR_SYSTEM_PROMPT = `Act as an expert OCR system specializing in New Zealand restaurant invoices (Tax Invoices).
Your goal is to extract data with 100% numerical accuracy.

### OUTPUT STRUCTURE:
Return ONLY a raw JSON object matching this exact schema:
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
1. GST is 15% in New Zealand.
2. Keep quantity decimals exactly.
3. If a field is unreadable, return null.
4. Return strict JSON only.`;

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function envAny(...names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  throw new Error(`${names.join(' or ')} is not configured`);
}

const supabase = createClient(envAny('SUPABASE_URL', 'PROJECT_URL'), envAny('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
});

function validateFinancials(totals: InvoiceData['totals']): InvoiceData['totals'] {
  const expected = Math.round((totals.sub_total + (totals.freight ?? 0) + totals.gst_amount) * 100) / 100;
  if (Math.abs(expected - totals.total_amount) > 0.01) {
    return { ...totals, calculation_error: true };
  }
  return totals;
}

function parseInvoiceJson(rawText: string): InvoiceData {
  const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  const candidate = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;
  const parsed = JSON.parse(candidate) as InvoiceData;
  parsed.totals = validateFinancials(parsed.totals);
  return parsed;
}

function buildBackoffSeconds(attempts: number): number {
  if (attempts <= 1) return 5;
  if (attempts === 2) return 15;
  if (attempts === 3) return 30;
  return 60;
}

async function claimJob(jobId: string, workerId: string): Promise<ClaimedJob | null> {
  const staleAfterSeconds = Number(Deno.env.get('OCR_STALE_AFTER_SECONDS') ?? '300');
  const { data, error } = await supabase.rpc('claim_ocr_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_stale_after_seconds: staleAfterSeconds,
  });

  if (error) throw error;
  if (!data) return null;
  if (Array.isArray(data)) {
    return (data[0] as ClaimedJob | undefined) ?? null;
  }
  return data as ClaimedJob;
}

async function loadImageBase64(bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to download OCR job image');
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

async function runGeminiOcr(job: ClaimedJob): Promise<{ data: InvoiceData; provider: string; model: string }> {
  const apiKey = env('GEMINI_API_KEY');
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
  const imageBase64 = await loadImageBase64(job.storage_bucket, job.storage_path);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: OCR_SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Extract invoice data from this image.' },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Gemini OCR failed: ${response.status} ${text}`);
  }

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part?.text ?? '').join('').trim();
  if (!text) throw new Error('Gemini OCR returned empty content');

  return {
    data: parseInvoiceJson(text),
    provider: 'gemini',
    model,
  };
}

async function markJobSucceeded(jobId: string, input: {
  invoiceId: string;
  provider: string;
  model: string;
}) {
  const { error } = await supabase
    .from('ocr_jobs')
    .update({
      status: 'succeeded',
      invoice_id: input.invoiceId,
      ocr_provider: input.provider,
      ocr_model: input.model,
      locked_at: null,
      locked_by: null,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    })
    .eq('id', jobId);

  if (error) throw error;
}

async function markJobFailed(job: ClaimedJob, errorMessage: string, errorCode = 'OCR_FAILED') {
  const retryable = job.attempts < job.max_attempts;
  const nextRunAt = retryable
    ? new Date(Date.now() + buildBackoffSeconds(job.attempts) * 1000).toISOString()
    : null;

  const { error } = await supabase
    .from('ocr_jobs')
    .update({
      status: retryable ? 'queued' : 'failed',
      next_run_at: nextRunAt ?? new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      finished_at: retryable ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_code: errorCode,
      error_message: errorMessage.slice(0, 1000),
    })
    .eq('id', job.id);

  if (error) throw error;
}

async function saveOcrResult(job: ClaimedJob, payload: { data: InvoiceData; provider: string; model: string }) {
  const response = await fetch(`${env('APP_BASE_URL').replace(/\/$/, '')}/api/internal/ocr-jobs/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ocr-worker-secret': env('OCR_WORKER_WEBHOOK_SECRET'),
    },
    body: JSON.stringify({
      jobId: job.id,
      imageUrl: job.public_url,
      data: payload.data,
      ocr: {
        provider: payload.provider,
        model: payload.model,
      },
    }),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(json?.error ?? `Failed to save OCR result (${response.status})`);
  }

  return json as { invoiceId: string };
}

async function processJob(jobId: string) {
  const workerId = `ocr-worker-${crypto.randomUUID()}`;
  const job = await claimJob(jobId, workerId);
  if (!job) {
    console.log(`[OCR Worker] Skip job ${jobId} — already claimed or not runnable`);
    return;
  }

  console.log(`[OCR Worker] Processing job ${job.id} attempt ${job.attempts}/${job.max_attempts}`);

  try {
    const ocr = await runGeminiOcr(job);
    const saved = await saveOcrResult(job, ocr);
    await markJobSucceeded(job.id, {
      invoiceId: saved.invoiceId,
      provider: ocr.provider,
      model: ocr.model,
    });
    console.log(`[OCR Worker] Job ${job.id} succeeded`);
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[OCR Worker] Job ${job.id} failed: ${message}`);
    await markJobFailed(job, message);
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const jobId = typeof body?.job_id === 'string' ? body.job_id.trim() : '';
    if (!jobId) {
      return new Response(JSON.stringify({ error: 'job_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    EdgeRuntime.waitUntil(processJob(jobId));

    return new Response(JSON.stringify({ accepted: true, jobId }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
