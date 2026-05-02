import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { createOtherExpense, listOtherExpenses } from '@/lib/finance-db-service';

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
    const rows = await listOtherExpenses({ from, to, category });
    return NextResponse.json({ expenses: rows });
  } catch (err) {
    console.error('[API] GET /api/finance/other-expenses error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try { await requireRole(request, 'admin'); } catch (err) { return handleAuthError(err); }

  try {
    const body = await request.json();
    if (!body.category) return NextResponse.json({ error: 'category is required' }, { status: 400 });
    if (!body.amount) return NextResponse.json({ error: 'amount is required' }, { status: 400 });
    if (!body.expense_date) return NextResponse.json({ error: 'expense_date is required' }, { status: 400 });

    const row = await createOtherExpense(body);
    return NextResponse.json({ expense: row }, { status: 201 });
  } catch (err) {
    console.error('[API] POST /api/finance/other-expenses error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
