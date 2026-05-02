import { NextRequest, NextResponse } from 'next/server';
import { listActiveOcrJobs, listFinishedOcrJobs } from '@/lib/ocr-jobs';
import { requireSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request);
    const limit = Math.min(20, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') ?? '10', 10)));
    const jobs = await listActiveOcrJobs(limit);
    const finished = session.role === 'admin' ? [] : await listFinishedOcrJobs(limit);
    const merged = session.role === 'admin' ? jobs : [...jobs, ...finished];
    const visible = session.role === 'admin' ? merged : merged.filter((j) => j.created_by === session.userId);

    return NextResponse.json({
      jobs: visible.map((job) => ({
        id: job.id,
        status: job.status,
        invoice_id: job.invoice_id,
        public_url: job.public_url,
        created_by: job.created_by,
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
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
