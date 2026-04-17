import { NextRequest, NextResponse } from 'next/server';
import { getCostReport } from '@/lib/db-service';

export const runtime = 'nodejs';

function parseYyyyMmDd(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  return trimmed;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  try {
    const report = await getCostReport({
      status: searchParams.get('status') ?? 'all',
      from: parseYyyyMmDd(searchParams.get('from')),
      to: parseYyyyMmDd(searchParams.get('to')),
      vendor: searchParams.get('vendor')?.trim() || undefined,
      productQ: searchParams.get('product_q')?.trim() || undefined,
      insightLimit: Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '10', 10))),
    });

    return NextResponse.json(report);
  } catch (err) {
    console.error('[API/reports/cost GET]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
