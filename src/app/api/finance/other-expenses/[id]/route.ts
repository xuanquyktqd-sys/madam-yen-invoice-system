import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { updateOtherExpense, deleteOtherExpense } from '@/lib/finance-db-service';

function handleAuthError(err: unknown): NextResponse {
  const msg = (err as Error).message;
  if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRole(request, 'admin'); } catch (err) { return handleAuthError(err); }

  const { id } = await params;
  try {
    const body = await request.json();
    const row = await updateOtherExpense(id, body);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ expense: row });
  } catch (err) {
    console.error(`[API] PATCH /api/finance/other-expenses/${id} error:`, err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRole(request, 'admin'); } catch (err) { return handleAuthError(err); }

  const { id } = await params;
  try {
    const ok = await deleteOtherExpense(id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[API] DELETE /api/finance/other-expenses/${id} error:`, err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
