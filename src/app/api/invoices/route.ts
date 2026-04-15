/**
 * API Route: GET /api/invoices + PATCH /api/invoices
 * Uses pg-based db-service for reliable direct DB access
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createManualInvoice,
  deleteInvoice,
  getInvoiceById,
  getInvoiceImageUrl,
  listInvoices,
  ManualInvoiceItemInput,
  patchInvoice,
  patchInvoiceWithItems,
} from '@/lib/db-service';
import { deleteInvoiceImageByPublicUrl } from '@/lib/storage-service';

function parseYyyyMmDd(value: string | null): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  return v;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') ?? 'all';
  const search = searchParams.get('search') ?? '';
  const from = parseYyyyMmDd(searchParams.get('from'));
  const to = parseYyyyMmDd(searchParams.get('to'));
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') ?? '20', 10));
  const offset = (page - 1) * limit;

  try {
    const { invoices, total } = await listInvoices({ status, search, from, to, limit, offset });
    return NextResponse.json({ invoices, total, page, limit });
  } catch (err) {
    console.error('[API/invoices GET]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, invoice_items, ...updates } = body as { id?: string; invoice_items?: unknown };

    if (!id) {
      return NextResponse.json({ error: 'Invoice ID required' }, { status: 400 });
    }

    const items: ManualInvoiceItemInput[] | undefined = Array.isArray(invoice_items)
      ? (invoice_items as unknown[])
          .filter((x) => typeof x === 'object' && x !== null)
          .map((x) => x as ManualInvoiceItemInput)
      : undefined;

    const ok = Array.isArray(items)
      ? await patchInvoiceWithItems(id, updates, items)
      : await patchInvoice(id, updates);
    if (!ok) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const invoice = await getInvoiceById(id);
    return NextResponse.json({ success: true, invoice });
  } catch (err) {
    console.error('[API/invoices PATCH]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await createManualInvoice(body);

    if (result.duplicate) {
      return NextResponse.json({ warning: 'Duplicate invoice', invoiceId: result.invoiceId, duplicate: true }, { status: 409 });
    }
    if (!result.success || !result.invoiceId) {
      return NextResponse.json({ error: result.error ?? 'Create invoice failed' }, { status: 400 });
    }

    const invoice = await getInvoiceById(result.invoiceId);
    return NextResponse.json({ success: true, invoiceId: result.invoiceId, invoice }, { status: 201 });
  } catch (err) {
    console.error('[API/invoices POST]', err);
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
