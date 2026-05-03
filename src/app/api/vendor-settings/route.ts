import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import {
  createVendor,
  deleteVendorById,
  listVendorSettings,
  updateVendorPricesIncludeGst,
} from '@/lib/db-service';

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, 'admin');
    const vendors = await listVendorSettings();
    return NextResponse.json({ vendors });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireRole(request, 'admin');
    const body = await request.json().catch(() => ({}));
    const { vendor_id, name, gst_number, address, default_category, prices_include_gst } = body;

    if (!vendor_id) {
      return NextResponse.json({ error: 'vendor_id is required' }, { status: 400 });
    }

    // Vá Database nếu thiếu cột (Migration nhanh)
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await pool.query(`
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS default_category TEXT;
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
    `).catch(e => console.error('Migration error:', e));

    const { updateVendor } = await import('@/lib/db-service');
    const ok = await updateVendor(vendor_id, {
      name,
      gst_number,
      address,
      default_category,
      prices_include_gst
    });

    if (!ok) return NextResponse.json({ error: 'Failed to update vendor' }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireRole(request, 'admin');
    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const gstNumber = typeof body?.gst_number === 'string' ? body.gst_number.trim() : null;
    const address = typeof body?.address === 'string' ? body.address.trim() : null;
    const pricesIncludeGst =
      typeof body?.prices_include_gst === 'boolean' ? body.prices_include_gst : false;

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const vendor = await createVendor({
      name,
      gst_number: gstNumber || null,
      address: address || null,
      prices_include_gst: pricesIncludeGst,
    });

    return NextResponse.json({ success: true, vendor }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireRole(request, 'admin');
    const body = await request.json().catch(() => ({}));
    const vendorId = typeof body?.vendor_id === 'string' ? body.vendor_id : '';
    if (!vendorId) {
      return NextResponse.json({ error: 'vendor_id is required' }, { status: 400 });
    }

    const res = await deleteVendorById(vendorId);
    if (!res.ok) {
      return NextResponse.json({ error: res.error ?? 'Failed to delete vendor' }, { status: res.status ?? 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
