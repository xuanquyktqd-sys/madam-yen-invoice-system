import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getFinanceSummary } from '@/lib/finance-db-service';

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
    const summary = await getFinanceSummary({ from, to });
    return NextResponse.json(summary);
  } catch (err) {
    console.error('[API] GET /api/finance/summary error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
