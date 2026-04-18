import { NextRequest, NextResponse } from 'next/server';
import { retryOcrJob, triggerOcrWorker } from '@/lib/ocr-jobs';

export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const job = await retryOcrJob(id);
    const triggered = await triggerOcrWorker(id).catch(() => false);

    return NextResponse.json({
      success: true,
      triggered,
      job: {
        id: job.id,
        status: job.status,
        attempts: job.attempts,
        max_attempts: job.max_attempts,
        next_run_at: job.next_run_at,
      },
    });
  } catch (err) {
    const message = (err as Error).message;
    const status =
      message === 'OCR job not found' ? 404 :
      message.includes('cannot be retried') || message.includes('max retry attempts') ? 409 :
      500;

    console.error('[API/ocr-jobs/:id/retry POST]', err);
    return NextResponse.json({ error: message }, { status });
  }
}
