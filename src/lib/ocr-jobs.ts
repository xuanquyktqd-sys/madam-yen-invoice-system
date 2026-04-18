import { supabaseAdmin } from './supabase';

export type OcrJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

export type OcrJobRecord = {
  id: string;
  status: OcrJobStatus;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  invoice_id: string | null;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  locked_at: string | null;
  locked_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  ocr_provider: string | null;
  ocr_model: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

const WORKER_NAME = 'ocr-worker';

function getSupabaseFunctionUrl(name: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  return `${base.replace(/\/$/, '')}/functions/v1/${name}`;
}

export async function triggerOcrWorker(jobId: string): Promise<boolean> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');

  const res = await fetch(getSupabaseFunctionUrl(WORKER_NAME), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ job_id: jobId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[OCR Jobs] Worker trigger failed for ${jobId}: ${res.status} ${text}`);
    return false;
  }

  return true;
}

export async function getOcrJob(jobId: string): Promise<OcrJobRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('ocr_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as OcrJobRecord | null) ?? null;
}

export async function listActiveOcrJobs(limit = 10): Promise<OcrJobRecord[]> {
  const { data, error } = await supabaseAdmin
    .from('ocr_jobs')
    .select('*')
    .in('status', ['queued', 'processing'])
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 20)));

  if (error) throw new Error(error.message);
  return (data as OcrJobRecord[] | null) ?? [];
}

export async function listFinishedOcrJobs(limit = 20): Promise<OcrJobRecord[]> {
  const { data, error } = await supabaseAdmin
    .from('ocr_jobs')
    .select('*')
    .in('status', ['succeeded', 'failed'])
    .order('finished_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 50)));

  if (error) throw new Error(error.message);
  return (data as OcrJobRecord[] | null) ?? [];
}

export async function queueOcrJob(input: {
  id: string;
  bucket: string;
  path: string;
  publicUrl: string | null;
  maxAttempts?: number;
}): Promise<OcrJobRecord> {
  const { data, error } = await supabaseAdmin
    .from('ocr_jobs')
    .insert({
      id: input.id,
      status: 'queued',
      storage_bucket: input.bucket,
      storage_path: input.path,
      public_url: input.publicUrl,
      max_attempts: input.maxAttempts ?? 3,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create OCR job');
  }

  return data as OcrJobRecord;
}

export async function retryOcrJob(jobId: string, staleAfterSeconds = 300): Promise<OcrJobRecord> {
  const job = await getOcrJob(jobId);
  if (!job) throw new Error('OCR job not found');

  const now = Date.now();
  const nextRunAt = job.next_run_at ? new Date(job.next_run_at).getTime() : null;
  const lockedAt = job.locked_at ? new Date(job.locked_at).getTime() : null;
  const isStaleProcessing =
    job.status === 'processing' &&
    lockedAt !== null &&
    now - lockedAt > staleAfterSeconds * 1000;

  if (!isStaleProcessing && job.status === 'queued' && nextRunAt !== null && nextRunAt > now) {
    const seconds = Math.max(1, Math.round((nextRunAt - now) / 1000));
    throw new Error(`OCR job is backing off. Try again in ${seconds}s`);
  }

  if (
    !isStaleProcessing &&
    job.status !== 'failed' &&
    job.status !== 'queued'
  ) {
    throw new Error('OCR job cannot be retried right now');
  }

  if (job.attempts >= job.max_attempts) {
    throw new Error('OCR job has reached max retry attempts');
  }

  const patch = {
    status: 'queued',
    next_run_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    started_at: null,
    finished_at: null,
    error_code: null,
    error_message: null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('ocr_jobs')
    .update(patch)
    .eq('id', jobId)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to retry OCR job');
  }

  return data as OcrJobRecord;
}
