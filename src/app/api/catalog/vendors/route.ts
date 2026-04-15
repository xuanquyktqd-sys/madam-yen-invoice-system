import { NextResponse } from 'next/server';
import { listVendors } from '@/lib/db-service';

export async function GET() {
  try {
    const vendors = await listVendors();
    return NextResponse.json({ vendors });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

