import { NextResponse } from 'next/server';
import { cleanupOrphanCatalog } from '@/lib/db-service';
import { requireRole } from '@/lib/auth';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    await requireRole(request, 'admin');
    const result = await cleanupOrphanCatalog();
    return NextResponse.json({ success: true, result });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
