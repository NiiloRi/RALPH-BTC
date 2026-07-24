/**
 * Request-scoped auth helpers for server components and server actions.
 *
 * Server actions are public HTTP endpoints — every mutation MUST call
 * requireUser()/requireAdmin() as its first line and never trust that "the
 * page was gated" (the proxy gate protects navigation, not the action POST).
 */

import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from './session';
import { getUserById } from './user-store';
import type { UserRecord } from './types';

/** Full session check: valid JWT + user still active + tokenVersion match. */
export async function getSessionUser(): Promise<UserRecord | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  const user = await getUserById(claims.sub);
  if (!user || user.status !== 'active' || user.tokenVersion !== claims.v) return null;
  return user;
}

export async function requireUser(): Promise<UserRecord> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireAdmin(): Promise<UserRecord> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');
  return user;
}
