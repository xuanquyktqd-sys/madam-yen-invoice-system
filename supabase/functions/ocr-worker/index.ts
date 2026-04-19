// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

type InvoiceData = {
  invoice_metadata: {
    vendor_name: string;
    vendor_gst_number: string | null;
    invoice_number: string | null;
    date: string;
  };
  line_items: Array<{
    raw_row_text: string;
    product_code: string | null;
    description: string;
    standard?: string | null;
    quantity: number | null;
    unit: string | null;
    price: number | null;
    amount_excl_gst?: number;
  }>;
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

function parseInvoiceJson(rawText: string): InvoiceData {
  const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  const candidate = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;
  const parsed = JSON.parse(candidate) as InvoiceData;
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

async function runDeepInfraGeminiOcr(job: ClaimedJob): Promise<{ data: InvoiceData; provider: string; model: string }> {
  const apiKey = envAny('DEEPINFRA_API_KEY', 'OPENAI_API_KEY');
  const model = Deno.env.get('DEEPINFRA_MODEL') ?? 'google/gemini-2.5-flash';
  const imageBase64 = await loadImageBase64(job.storage_bucket, job.storage_path);
  const dataUrl = `data:image/jpeg;base64,${imageBase64}`;

  const response = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
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
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`DeepInfra OCR failed: ${response.status} ${text}`);
  }

  const json = await response.json();
  const raw = getTextContent(json?.choices?.[0]?.message?.content).trim();
  if (!raw) throw new Error('DeepInfra OCR returned empty content');

  return {
    data: parseInvoiceJson(raw),
    provider: 'deepinfra',
    model,
  };
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
              { text: 'Extract invoice metadata and the line items table (top-to-bottom). Return strict JSON only.' },
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

async function runOcrWithFallback(job: ClaimedJob): Promise<{ data: InvoiceData; provider: string; model: string }> {
  try {
    return await runDeepInfraGeminiOcr(job);
  } catch (err) {
    console.warn(`[OCR Worker] Primary DeepInfra failed; falling back to Gemini official. ${String((err as Error)?.message ?? err)}`);
    return await runGeminiOcr(job);
  }
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
    const ocr = await runOcrWithFallback(job);
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
