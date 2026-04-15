import { NextResponse } from 'next/server';
import { listStandards } from '@/lib/db-service';

export async function GET() {
  try {
    const standards = await listStandards();
    return NextResponse.json({ standards });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

