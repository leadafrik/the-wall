// Issues a signed session cookie on every browser visit. The cookie is
// required by /api/notes* read endpoints, so `curl` and unconfigured bots
// can't drain the wall.
//
// Real visitors get the cookie transparently on first page load (any HTML
// route triggers this middleware). The cookie is HttpOnly so JS can't read
// or forge it, and Lax SameSite so it rides along on same-origin fetches.

import { NextRequest, NextResponse } from 'next/server';

import {
  MAX_AGE_MS,
  SESSION_COOKIE,
  issueSessionToken,
  verifySessionToken,
} from '@/lib/session';

export async function middleware(req: NextRequest) {
  const existing = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(existing)) {
    return NextResponse.next();
  }

  const token = await issueSessionToken();
  const res = NextResponse.next();
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(MAX_AGE_MS / 1000),
  });
  return res;
}

// Don't run on static assets or Next internals.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
