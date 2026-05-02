import { NextRequest, NextResponse } from 'next/server';
import { listProducts } from '@/lib/db-service';
import { requireRole } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, 'admin');
    const { searchParams } = request.nextUrl;
    const vendorName = searchParams.get('vendor') ?? '';
    const q = searchParams.get('q') ?? '';
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '200', 10)));

    const products = await listProducts({ vendorName, q, limit });
    return NextResponse.json({ products });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
