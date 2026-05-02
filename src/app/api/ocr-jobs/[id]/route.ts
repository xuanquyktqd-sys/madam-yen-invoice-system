import { NextRequest, NextResponse } from 'next/server';
import { getOcrJob } from '@/lib/ocr-jobs';
import { requireSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession(request);
    const { id } = await context.params;
    const job = await getOcrJob(id);

    if (!job) {
      return NextResponse.json({ error: 'OCR job not found' }, { status: 404 });
    }

    if (session.role !== 'admin' && job.created_by !== session.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({
      job: {
        id: job.id,
        status: job.status,
        invoice_id: job.invoice_id,
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
      },
    });
  } catch (err) {
    console.error('[API/ocr-jobs/:id GET]', err);
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
