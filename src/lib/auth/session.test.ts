import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  signSession,
  verifySessionToken,
  getAuthSecret,
  signFormToken,
  verifyFormToken,
  sessionCookieOptions,
  MIN_FORM_FILL_MS,
} from './session';

const SECRET = 'test-secret-0123456789abcdef-0123456789abcdef';

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.AUTH_SECRET;
});

describe('getAuthSecret', () => {
  it('throws when missing (fail closed)', () => {
    delete process.env.AUTH_SECRET;
    expect(() => getAuthSecret()).toThrow(/AUTH_SECRET/);
  });
  it('throws when shorter than 32 chars', () => {
    process.env.AUTH_SECRET = 'too-short';
    expect(() => getAuthSecret()).toThrow(/32/);
  });
});

describe('session JWT', () => {
  const claims = { sub: 'u1', username: 'Niilo', role: 'admin' as const, v: 3 };

  it('sign → verify roundtrip preserves claims', async () => {
    const token = await signSession(claims);
    const out = await verifySessionToken(token);
    expect(out).toEqual(claims);
  });

  it('tampered token → null', async () => {
    const token = await signSession(claims);
    const tampered = token.slice(0, -4) + 'AAAA';
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it('token signed with another secret → null', async () => {
    const token = await signSession(claims);
    process.env.AUTH_SECRET = 'other-secret-0123456789abcdef-0123456789ab';
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('garbage → null', async () => {
    expect(await verifySessionToken('not-a-jwt')).toBeNull();
    expect(await verifySessionToken('')).toBeNull();
  });
});

describe('sessionCookieOptions', () => {
  it('is httpOnly, lax, path=/ with 30d maxAge', () => {
    const o = sessionCookieOptions();
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe('lax');
    expect(o.path).toBe('/');
    expect(o.maxAge).toBe(60 * 60 * 24 * 30);
    // secure follows NODE_ENV; under vitest NODE_ENV=test → false (dev http works)
    expect(o.secure).toBe(false);
  });
});

describe('form token (registration min-fill-time)', () => {
  it('roundtrips and reports mint time', async () => {
    const before = Date.now();
    const token = await signFormToken('register');
    const out = await verifyFormToken(token, 'register');
    expect(out).not.toBeNull();
    // iat has second granularity
    expect(Math.abs(out!.iatMs - before)).toBeLessThan(2000);
  });
  it('rejects tampered/garbage tokens', async () => {
    expect(await verifyFormToken('garbage', 'register')).toBeNull();
  });
  it('MIN_FORM_FILL_MS is 3s — the action-level rule this powers', () => {
    expect(MIN_FORM_FILL_MS).toBe(3000);
  });
});
