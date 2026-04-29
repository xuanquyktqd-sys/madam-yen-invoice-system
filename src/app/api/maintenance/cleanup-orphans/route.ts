import { NextResponse } from 'next/server';
import { cleanupOrphanCatalog } from '@/lib/db-service';

export async function POST() {
  try {
    const result = await cleanupOrphanCatalog();
    return NextResponse.json({ success: true, result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

