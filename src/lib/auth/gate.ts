/**
 * Pure gate logic for src/proxy.ts — no next/server imports so this is fully
 * unit-testable. The proxy matcher already excludes /_next/static and
 * /_next/image; everything else (all pages, /api/risk-data, and every file
 * served from public/ — including risk_data.json and the CSV fallbacks, which
 * would otherwise leak the product data) flows through evaluateGate.
 */

/** Exact-match public paths — no prefix matching, so /login-evil stays gated. */
const PUBLIC_PATHS = new Set([
  '/login',
  '/register',
  // Browsers request these before any auth; they live in src/app/ and leak nothing.
  '/favicon.ico',
  '/icon.svg',
  '/apple-icon.png',
]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export type GateDecision =
  | { action: 'allow' }
  | { action: 'redirect'; to: string }
  | { action: 'deny-json' };

/**
 * Decide what to do with a request.
 *
 * Unauthenticated document navigations are redirected to /login (preserving
 * the target in ?next=); everything else (JSON/CSV fetches, API calls) gets a
 * 401 JSON denial — NOT a redirect, because fetch() follows redirects and the
 * dashboard's fallback chain would otherwise parse the login HTML as data.
 */
export function evaluateGate(input: {
  pathname: string;
  isAuthenticated: boolean;
  isDocumentRequest: boolean;
}): GateDecision {
  const { pathname, isAuthenticated, isDocumentRequest } = input;

  if (isPublicPath(pathname)) {
    // Signed-in users have no business on the auth pages — bounce home.
    if (isAuthenticated && (pathname === '/login' || pathname === '/register')) {
      return { action: 'redirect', to: '/' };
    }
    return { action: 'allow' };
  }

  if (isAuthenticated) return { action: 'allow' };

  if (isDocumentRequest) {
    const to =
      pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(pathname)}`;
    return { action: 'redirect', to };
  }
  return { action: 'deny-json' };
}

/**
 * Sanitize a ?next= redirect target: same-origin relative paths only.
 * Rejects absolute URLs, protocol-relative //host, and backslash tricks.
 */
export function sanitizeNextParam(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  if (raw.includes('\\')) return '/';
  return raw;
}
