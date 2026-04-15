/**
 * API Route: GET /api/invoices + PATCH /api/invoices
 * Uses pg-based db-service for reliable direct DB access
 */

import { NextRequest, NextResponse } from 'next/server';
import { deleteInvoice, getInvoiceImageUrl, listInvoices, patchInvoice } from '@/lib/db-service';
import { deleteInvoiceImageByPublicUrl } from '@/lib/storage-service';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') ?? 'all';
  const search = searchParams.get('search') ?? '';
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') ?? '20', 10));
  const offset = (page - 1) * limit;

  try {
    const { invoices, total } = await listInvoices({ status, search, limit, offset });
    return NextResponse.json({ invoices, total, page, limit });
  } catch (err) {
    console.error('[API/invoices GET]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Invoice ID required' }, { status: 400 });
    }

    const ok = await patchInvoice(id, updates);
    if (!ok) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API/invoices PATCH]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = (body as { id?: string })?.id ?? request.nextUrl.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Invoice ID required' }, { status: 400 });
    }

    const imageUrl = await getInvoiceImageUrl(id);

    const ok = await deleteInvoice(id);
    if (!ok) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (imageUrl) {
      try {
        await deleteInvoiceImageByPublicUrl(imageUrl);
      } catch (err) {
        console.warn('[API/invoices DELETE] Storage cleanup failed:', (err as Error).message);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API/invoices DELETE]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
