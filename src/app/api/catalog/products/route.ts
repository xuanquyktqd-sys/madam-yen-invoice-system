import { NextRequest, NextResponse } from 'next/server';
import { listProducts } from '@/lib/db-service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const vendorName = searchParams.get('vendor') ?? '';
    const q = searchParams.get('q') ?? '';
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '200', 10)));

    const products = await listProducts({ vendorName, q, limit });
    return NextResponse.json({ products });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

