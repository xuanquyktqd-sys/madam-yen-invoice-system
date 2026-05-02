import { NextRequest, NextResponse } from 'next/server';
import { createCreditNoteFromInvoice, getInvoiceById } from '@/lib/db-service';
import { requireRole } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    await requireRole(request, 'admin');
    const body = await request.json();
    const result = await createCreditNoteFromInvoice(body);

    if (!result.success || !result.invoiceId) {
      return NextResponse.json({ error: result.error ?? 'Create credit note failed' }, { status: 400 });
    }

    const invoice = await getInvoiceById(result.invoiceId);
    return NextResponse.json({ success: true, invoiceId: result.invoiceId, invoice }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
