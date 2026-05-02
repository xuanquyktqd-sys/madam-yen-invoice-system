import { NextRequest, NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, 'admin');
    const { data, error } = await supabaseAdmin
      .from('app_users')
      .select('id, username, role, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ users: data ?? [] });
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
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const role = body.role === 'admin' ? 'admin' : 'staff';
    if (!username || !password) {
      return NextResponse.json({ error: 'username and password are required' }, { status: 400 });
    }

    const password_hash = await hash(password, 10);
    const { data, error } = await supabaseAdmin
      .from('app_users')
      .insert({ username, password_hash, role })
      .select('id, username, role, created_at, updated_at')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ user: data }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireRole(request, 'admin');
    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id')?.trim();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (id === session.userId) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 409 });

    const { error } = await supabaseAdmin.from('app_users').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
