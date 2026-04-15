import { NextResponse } from 'next/server';
import { listUnits } from '@/lib/db-service';

export async function GET() {
  try {
    const units = await listUnits();
    return NextResponse.json({ units });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

