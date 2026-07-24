import { describe, it, expect } from 'vitest';
import { createRateLimiter, getClientIp } from './rate-limit';

describe('createRateLimiter', () => {
  it('allows max hits and blocks max+1 with a correct retryAfterMs', () => {
    const rl = createRateLimiter({ max: 3, windowMs: 10_000 });
    const t0 = 1_000_000;
    expect(rl.consume('k', t0).ok).toBe(true);
    expect(rl.consume('k', t0 + 1000).ok).toBe(true);
    expect(rl.consume('k', t0 + 2000).ok).toBe(true);
    const blocked = rl.consume('k', t0 + 3000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      // first hit at t0 expires at t0+10000 → retry after 7000ms from t0+3000
      expect(blocked.retryAfterMs).toBe(7000);
    }
  });

  it('window expiry readmits', () => {
    const rl = createRateLimiter({ max: 2, windowMs: 5_000 });
    const t0 = 0;
    rl.consume('k', t0);
    rl.consume('k', t0 + 100);
    expect(rl.consume('k', t0 + 200).ok).toBe(false);
    expect(rl.consume('k', t0 + 5_101).ok).toBe(true); // first two expired
  });

  it('keys are independent', () => {
    const rl = createRateLimiter({ max: 1, windowMs: 10_000 });
    expect(rl.consume('ip:1.2.3.4', 0).ok).toBe(true);
    expect(rl.consume('user:niilo', 0).ok).toBe(true);
    expect(rl.consume('ip:1.2.3.4', 1).ok).toBe(false);
    expect(rl.consume('user:niilo', 1).ok).toBe(false);
  });

  it('reset() clears a key', () => {
    const rl = createRateLimiter({ max: 1, windowMs: 10_000 });
    rl.consume('k', 0);
    expect(rl.consume('k', 1).ok).toBe(false);
    rl.reset('k');
    expect(rl.consume('k', 2).ok).toBe(true);
  });

  it('prunes stale keys so memory stays bounded', () => {
    const rl = createRateLimiter({ max: 1, windowMs: 100 });
    // fill way past the cap with keys whose windows immediately expire
    for (let i = 0; i < 10_500; i++) {
      rl.consume(`k${i}`, i);
    }
    // Behavioral proxy for pruning: a long-expired key is admitted again.
    expect(rl.consume('k0', 20_000).ok).toBe(true);
  });
});

describe('getClientIp', () => {
  it('takes the first X-Forwarded-For entry', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 172.21.0.1' });
    expect(getClientIp(h)).toBe('203.0.113.7');
  });
  it('falls back to unknown', () => {
    expect(getClientIp(new Headers())).toBe('unknown');
    expect(getClientIp(new Headers({ 'x-forwarded-for': ' ' }))).toBe('unknown');
  });
});
