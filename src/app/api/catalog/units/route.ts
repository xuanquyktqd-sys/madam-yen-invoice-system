import { NextResponse } from 'next/server';
import { listUnits } from '@/lib/db-service';
import { requireRole } from '@/lib/auth';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, 'admin');
    const units = await listUnits();
    return NextResponse.json({ units });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
