/**
 * Whole-site auth gate (Next 16 proxy — the middleware.ts successor; always
 * runs on the Node.js runtime, so it can read the user store directly).
 *
 * Everything except /login, /register and the root icons requires a valid
 * session: signed JWT cookie + user still active + tokenVersion match. This
 * includes /api/risk-data and every file under public/ (risk_data.json, the
 * CSV fallbacks, btc_historical.json, fan_tau_history.json) — those hold the
 * product data.
 *
 * Unauthenticated document navigations → 307 /login?next=…
 * Unauthenticated fetches (JSON/CSV/API) → 401 JSON — never a redirect, or
 * the dashboard's fallback chain would parse the login page HTML as data.
 *
 * NOTE: the proxy bundle is compiled separately from the app bundle — no
 * shared module state. Rate limiting therefore lives in the server actions;
 * the user-store cache is mtime-invalidated, so both bundles converge.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { evaluateGate } from '@/lib/auth/gate';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';
import { ensureSeeded, getUserById } from '@/lib/auth/user-store';

export const config = {
  // Run on everything except build-static assets and the image optimizer.
  // public/ files are NOT excluded on purpose — they must be gated.
  matcher: ['/((?!_next/static|_next/image).*)'],
};

async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const claims = await verifySessionToken(token);
  if (!claims) return false;
  const user = await getUserById(claims.sub);
  return user !== null && user.status === 'active' && user.tokenVersion === claims.v;
}

function isDocumentRequest(request: NextRequest): boolean {
  const dest = request.headers.get('sec-fetch-dest');
  if (dest) return dest === 'document';
  return (request.headers.get('accept') ?? '').includes('text/html');
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  await ensureSeeded(); // first request seeds the admin from env

  const authenticated = await isAuthenticated(request);
  const decision = evaluateGate({
    pathname: request.nextUrl.pathname,
    isAuthenticated: authenticated,
    isDocumentRequest: isDocumentRequest(request),
  });

  switch (decision.action) {
    case 'allow':
      return NextResponse.next();
    case 'redirect': {
      const res = NextResponse.redirect(new URL(decision.to, request.url), 307);
      // A present-but-invalid cookie is stale — clear it on the way out.
      if (!authenticated && request.cookies.has(SESSION_COOKIE)) {
        res.cookies.delete(SESSION_COOKIE);
      }
      return res;
    }
    case 'deny-json': {
      const res = NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      if (request.cookies.has(SESSION_COOKIE)) {
        res.cookies.delete(SESSION_COOKIE);
      }
      return res;
    }
  }
}
