import { NextRequest, NextResponse } from 'next/server';
import { createCreditNoteFromInvoice, getInvoiceById } from '@/lib/db-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await createCreditNoteFromInvoice(body);

    if (!result.success || !result.invoiceId) {
      return NextResponse.json({ error: result.error ?? 'Create credit note failed' }, { status: 400 });
    }

    const invoice = await getInvoiceById(result.invoiceId);
    return NextResponse.json({ success: true, invoiceId: result.invoiceId, invoice }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

