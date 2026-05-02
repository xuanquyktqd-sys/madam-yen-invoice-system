import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { createLabourCost, listLabourCosts } from '@/lib/finance-db-service';

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
  const costType = searchParams.get('cost_type') ?? undefined;

  try {
    const rows = await listLabourCosts({ from, to, costType });
    return NextResponse.json({ costs: rows });
  } catch (err) {
    console.error('[API] GET /api/finance/labour error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try { await requireRole(request, 'admin'); } catch (err) { return handleAuthError(err); }

  try {
    const body = await request.json();
    if (!body.cost_type) return NextResponse.json({ error: 'cost_type is required' }, { status: 400 });
    if (!body.amount) return NextResponse.json({ error: 'amount is required' }, { status: 400 });
    if (!body.pay_date) return NextResponse.json({ error: 'pay_date is required' }, { status: 400 });

    const row = await createLabourCost(body);
    return NextResponse.json({ cost: row }, { status: 201 });
  } catch (err) {
    console.error('[API] POST /api/finance/labour error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
