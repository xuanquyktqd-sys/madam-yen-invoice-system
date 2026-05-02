import { SignJWT, jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export type AppRole = 'admin' | 'staff';

export type Session = {
  userId: string;
  role: AppRole;
};

const COOKIE_NAME = 'my_session';
const SESSION_TTL_DAYS = 7;

function getJwtSecret(): Uint8Array {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error('AUTH_JWT_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

export async function signSession(session: Session): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ role: session.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.userId)
    .setIssuedAt(now)
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    const role = payload.role === 'admin' || payload.role === 'staff' ? payload.role : null;
    if (!userId || !role) return null;
    return { userId, role };
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(request: NextRequest): Promise<Session | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return await verifySessionToken(token);
}

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function requireSession(request: NextRequest): Promise<Session> {
  const session = await getSessionFromRequest(request);
  if (!session) throw new Error('UNAUTHENTICATED');
  return session;
}

export async function requireRole(request: NextRequest, role: AppRole): Promise<Session> {
  const session = await requireSession(request);
  if (session.role !== role) throw new Error('FORBIDDEN');
  return session;
}

