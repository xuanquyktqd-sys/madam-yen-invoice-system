import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { upsertDailySales, listDailySales, deleteDailySales } from '@/lib/finance-db-service';

function handleAuthError(err: unknown): NextResponse {
  const msg = (err as Error).message;
  if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try { await requireRole(request, 'admin'); } catch (err) { return handleAuthError(err); }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;

  try {
    const rows = await listDailySales({ from, to });
    return NextResponse.json({ sales: rows });
  } catch (err) {
    console.error('[API] GET /api/finance/revenue error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try { await requireRole(request, 'admin'); } catch (err) { return handleAuthError(err); }

  try {
    const body = await request.json();

    // Support batch entries
    if (Array.isArray(body.entries)) {
      const results = [];
      for (const entry of body.entries) {
        const row = await upsertDailySales(entry);
        results.push(row);
      }
      return NextResponse.json({ sales: results }, { status: 201 });
    }

    if (!body.sale_date) {
      return NextResponse.json({ error: 'sale_date is required' }, { status: 400 });
    }

    const row = await upsertDailySales(body);
    return NextResponse.json({ sale: row }, { status: 201 });
  } catch (err) {
    console.error('[API] POST /api/finance/revenue error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try { await requireRole(request, 'admin'); } catch (err) { return handleAuthError(err); }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  try {
    const ok = await deleteDailySales(id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[API] DELETE /api/finance/revenue error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
