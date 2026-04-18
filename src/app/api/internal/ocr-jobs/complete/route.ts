import { NextRequest, NextResponse } from 'next/server';
import { getInvoiceById, saveInvoice } from '@/lib/db-service';
import { InvoiceData } from '@/lib/ocr-service';

export const runtime = 'nodejs';

type CompleteJobBody = {
  jobId?: string;
  imageUrl?: string;
  data?: InvoiceData;
};

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.OCR_WORKER_WEBHOOK_SECRET;
  if (!expected) return false;
  return request.headers.get('x-ocr-worker-secret') === expected;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as CompleteJobBody;
    const jobId = body.jobId?.trim();
    const imageUrl = body.imageUrl?.trim();
    const data = body.data;

    if (!jobId || !imageUrl || !data) {
      return NextResponse.json({ error: 'jobId, imageUrl and data are required' }, { status: 400 });
    }

    const result = await saveInvoice(data, imageUrl, jobId);

    if (!result.success || !result.invoiceId) {
      return NextResponse.json({
        error: result.error ?? 'Failed to save OCR invoice',
        duplicate: !!result.duplicate,
        invoiceId: result.invoiceId ?? null,
      }, { status: result.duplicate ? 409 : 500 });
    }

    const invoice = await getInvoiceById(result.invoiceId);

    return NextResponse.json({
      success: true,
      invoiceId: result.invoiceId,
      duplicate: !!result.duplicate,
      invoice,
    });
  } catch (err) {
    console.error('[API/internal/ocr-jobs/complete POST]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
