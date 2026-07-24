/**
 * Session JWT + cookie options (jose, HS256).
 *
 * The session is an httpOnly cookie holding a signed JWT with a tokenVersion
 * claim; src/proxy.ts verifies the signature AND that the version still
 * matches the stored user, so disabling a user or changing a password
 * invalidates old sessions on their very next request.
 */

import { SignJWT, jwtVerify } from 'jose';
import type { SessionClaims, UserRole } from './types';

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

/** Fail closed: missing/short AUTH_SECRET must break auth, not open it. */
export function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET env var is required (>= 32 chars); see .env.example');
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ username: claims.username, role: claims.role, v: claims.v })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(getAuthSecret());
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret(), { algorithms: ['HS256'] });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.username !== 'string' ||
      (payload.role !== 'admin' && payload.role !== 'user') ||
      typeof payload.v !== 'number'
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      username: payload.username,
      role: payload.role as UserRole,
      v: payload.v,
    };
  } catch {
    return null;
  }
}

/** secure only in production: browser↔Caddy is HTTPS there; dev runs plain http. */
export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_S,
  };
}

// ---- registration form token (min-fill-time bot check) ----------------------

const FORM_TOKEN_TTL_S = 60 * 60; // 1 h

export async function signFormToken(purpose: 'register'): Promise<string> {
  return new SignJWT({ purpose })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${FORM_TOKEN_TTL_S}s`)
    .sign(getAuthSecret());
}

/** Returns the token's mint time (ms) or null if invalid/expired/wrong purpose. */
export async function verifyFormToken(
  token: string,
  purpose: 'register'
): Promise<{ iatMs: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret(), { algorithms: ['HS256'] });
    if (payload.purpose !== purpose || typeof payload.iat !== 'number') return null;
    return { iatMs: payload.iat * 1000 };
  } catch {
    return null;
  }
}

/** Minimum time a human plausibly needs to fill the registration form. */
export const MIN_FORM_FILL_MS = 3_000;
