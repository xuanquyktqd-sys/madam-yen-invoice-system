import { NextRequest, NextResponse } from 'next/server';
import { listVendorSettings, updateVendorPricesIncludeGst } from '@/lib/db-service';

export async function GET() {
  try {
    const vendors = await listVendorSettings();
    return NextResponse.json({ vendors });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const vendorId = typeof body?.vendor_id === 'string' ? body.vendor_id : '';
    const value = typeof body?.prices_include_gst === 'boolean' ? body.prices_include_gst : null;

    if (!vendorId || value === null) {
      return NextResponse.json({ error: 'vendor_id and prices_include_gst are required' }, { status: 400 });
    }

    const ok = await updateVendorPricesIncludeGst(vendorId, value);
    if (!ok) return NextResponse.json({ error: 'Failed to update vendor' }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

