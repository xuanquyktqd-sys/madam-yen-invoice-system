import { NextRequest, NextResponse } from 'next/server';
import { compare } from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase';
import { signSession, setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const usernameRaw = typeof body.username === 'string' ? body.username.trim() : '';
    const username = usernameRaw.toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('app_users')
      .select('id, username, password_hash, role')
      .ilike('username', username)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

    const ok = await compare(password, String((data as Record<string, unknown>).password_hash ?? ''));
    if (!ok) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

    const role = (data as Record<string, unknown>).role === 'admin' ? 'admin' : 'staff';
    const token = await signSession({ userId: String((data as Record<string, unknown>).id), role });

    const res = NextResponse.json({ success: true, role });
    setSessionCookie(res, token);
    return res;
  } catch (err) {
    console.error('[API/auth/login]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
