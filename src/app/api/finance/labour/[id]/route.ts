import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { updateLabourCost, deleteLabourCost } from '@/lib/finance-db-service';

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
    const row = await updateLabourCost(id, body);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ cost: row });
  } catch (err) {
    console.error(`[API] PATCH /api/finance/labour/${id} error:`, err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRole(request, 'admin'); } catch (err) { return handleAuthError(err); }

  const { id } = await params;
  try {
    const ok = await deleteLabourCost(id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[API] DELETE /api/finance/labour/${id} error:`, err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
