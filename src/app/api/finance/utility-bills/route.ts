import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { createUtilityBill, listUtilityBills } from '@/lib/finance-db-service';

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
  const category = searchParams.get('category') ?? undefined;

  try {
    const rows = await listUtilityBills({ from, to, category });
    return NextResponse.json({ bills: rows });
  } catch (err) {
    console.error('[API] GET /api/finance/utility-bills error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try { await requireRole(request, 'admin'); } catch (err) { return handleAuthError(err); }

  try {
    const body = await request.json();
    if (!body.category) return NextResponse.json({ error: 'category is required' }, { status: 400 });
    if (!body.total_amount) return NextResponse.json({ error: 'total_amount is required' }, { status: 400 });

    const row = await createUtilityBill(body);
    return NextResponse.json({ bill: row }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('duplicate') || msg.includes('unique')) {
      return NextResponse.json({ error: 'Duplicate bill detected' }, { status: 409 });
    }
    console.error('[API] POST /api/finance/utility-bills error:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
