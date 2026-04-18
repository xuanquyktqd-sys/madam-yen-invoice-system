import { NextRequest, NextResponse } from 'next/server';
import { listActiveOcrJobs } from '@/lib/ocr-jobs';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') ?? '10', 10)));
    const jobs = await listActiveOcrJobs(limit);

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        invoice_id: job.invoice_id,
        public_url: job.public_url,
        attempts: job.attempts,
        max_attempts: job.max_attempts,
        error_code: job.error_code,
        error_message: job.error_message,
        ocr_provider: job.ocr_provider,
        ocr_model: job.ocr_model,
        next_run_at: job.next_run_at,
        locked_at: job.locked_at,
        created_at: job.created_at,
        updated_at: job.updated_at,
      })),
    });
  } catch (err) {
    console.error('[API/ocr-jobs GET]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
