import { NextRequest, NextResponse } from 'next/server';
import { getOcrJob } from '@/lib/ocr-jobs';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const job = await getOcrJob(id);

    if (!job) {
      return NextResponse.json({ error: 'OCR job not found' }, { status: 404 });
    }

    return NextResponse.json({
      job: {
        id: job.id,
        status: job.status,
        invoice_id: job.invoice_id,
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
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
