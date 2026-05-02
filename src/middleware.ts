import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/auth';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
];

const PUBLIC_API_PREFIXES = [
  '/api/internal/ocr-jobs/complete',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname) || isPublicApi(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get('my_session')?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    if (isApiRoute(pathname)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Staff: block everything except upload + their OCR job polling.
  if (session.role === 'staff') {
    const allowedUi = pathname === '/upload' || pathname.startsWith('/upload/');
    const allowedApi =
      pathname === '/api/process' ||
      pathname === '/api/ocr-jobs' ||
      pathname.startsWith('/api/ocr-jobs/');

    if (isApiRoute(pathname)) {
      if (!allowedApi) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      return NextResponse.next();
    }

    if (!allowedUi) {
      const url = request.nextUrl.clone();
      url.pathname = '/upload';
      return NextResponse.redirect(url);
    }
  }

  // Admin: prevent visiting /upload-only flow (optional) — allow.
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - static files
     * - Next internals
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
