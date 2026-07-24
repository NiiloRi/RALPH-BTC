/**
 * In-memory sliding-window rate limiting for auth actions.
 *
 * Lives ONLY in the server-actions bundle (the proxy bundle is compiled
 * separately and would not share these Maps). The app runs as a single
 * `node server.js` process, so in-memory state is correct; counters reset on
 * container restart — an accepted tradeoff for a private tool.
 *
 * IP identification is best-effort bot filtering, not a security boundary:
 * X-Forwarded-For is trustworthy only for traffic proxied through Caddy.
 */

const MAX_KEYS = 10_000; // memory bound

export interface RateLimiter {
  consume(key: string, now?: number): { ok: true } | { ok: false; retryAfterMs: number };
  reset(key: string): void;
}

export function createRateLimiter(opts: { max: number; windowMs: number }): RateLimiter {
  const { max, windowMs } = opts;
  const hits = new Map<string, number[]>();

  function prune(now: number): void {
    if (hits.size <= MAX_KEYS) return;
    for (const [key, stamps] of hits) {
      if (stamps.length === 0 || now - stamps[stamps.length - 1] > windowMs) {
        hits.delete(key);
      }
      if (hits.size <= MAX_KEYS) break;
    }
  }

  return {
    consume(key: string, now: number = Date.now()) {
      const windowStart = now - windowMs;
      const stamps = (hits.get(key) ?? []).filter(t => t > windowStart);
      if (stamps.length >= max) {
        hits.set(key, stamps);
        return { ok: false as const, retryAfterMs: stamps[0] + windowMs - now };
      }
      stamps.push(now);
      hits.set(key, stamps);
      prune(now);
      return { ok: true as const };
    },
    reset(key: string) {
      hits.delete(key);
    },
  };
}

// ---- singletons used by the server actions ----------------------------------
export const loginIpLimiter = createRateLimiter({ max: 5, windowMs: 15 * 60_000 });
export const loginUserLimiter = createRateLimiter({ max: 5, windowMs: 15 * 60_000 });
export const registerIpHourLimiter = createRateLimiter({ max: 3, windowMs: 60 * 60_000 });
export const registerIpDayLimiter = createRateLimiter({ max: 10, windowMs: 24 * 60 * 60_000 });

/** First X-Forwarded-For entry (set by Caddy), or 'unknown'. */
export function getClientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (!xff) return 'unknown';
  const first = xff.split(',')[0]?.trim();
  return first || 'unknown';
}
