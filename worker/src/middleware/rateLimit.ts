/**
 * Rate limiting.
 *
 * Two strategies, chosen to fit the Cloudflare free tier:
 *
 * - `rateLimit()` keeps fixed-window counters in D1 using a single atomic
 *   upsert per request. Used for unauthenticated and abuse-prone endpoints
 *   (login, magic links, public share links, emergency requests), where a
 *   global and consistent limit matters. (KV was used before, but its free
 *   tier allows only 1,000 writes per day and it is eventually consistent, so
 *   concurrent requests could slip past the limit.)
 *
 * - `memoryRateLimit()` keeps counters in isolate memory. It is free and
 *   catches runaway clients on authenticated routes, which already require a
 *   valid session. It is per isolate, so it is a safety net, not a guarantee.
 */

import type { Next } from 'hono';
import type { AppContext } from '../env';
import { getClientIp, HttpError, nowSeconds } from '../lib/http';

export interface RateLimitConfig {
  /** Window length in seconds */
  windowSeconds: number;
  /** Requests allowed per window */
  maxRequests: number;
  /** Key prefix, unique per limiter */
  keyPrefix: string;
  /** Optional custom client key (defaults to the client IP) */
  keyFn?: (c: AppContext) => string | Promise<string>;
}

function clientKey(c: AppContext): string {
  const user = c.get('user');
  if (user) return `user:${user.id}`;
  return `ip:${getClientIp(c) ?? 'unknown'}`;
}

function tooManyRequests(c: AppContext, resetIn: number): never {
  c.header('Retry-After', String(resetIn));
  throw new HttpError(429, `Too many requests. Try again in ${resetIn} seconds.`, 'RATE_LIMITED', {
    retryAfter: resetIn,
  });
}

/**
 * Increment a D1 counter and return the new count. Exposed for routes that
 * need to rate limit on a value from the request body (for example an email).
 */
export async function hitCounter(
  db: D1Database,
  key: string,
  windowSeconds: number
): Promise<{ count: number; resetIn: number }> {
  const now = nowSeconds();
  const windowStart = now - (now % windowSeconds);
  const resetAt = windowStart + windowSeconds;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = count + 1
       RETURNING count`
    )
    .bind(`${key}:${windowStart}`, resetAt)
    .first<{ count: number }>();
  return { count: row?.count ?? 1, resetIn: resetAt - now };
}

/** Global, D1-backed fixed-window rate limiter. */
export function rateLimit(config: RateLimitConfig) {
  return async (c: AppContext, next: Next) => {
    const client = config.keyFn ? await config.keyFn(c) : clientKey(c);
    let result: { count: number; resetIn: number };
    try {
      result = await hitCounter(c.env.DB, `${config.keyPrefix}:${client}`, config.windowSeconds);
    } catch (err) {
      // Fail open: a rate limiter outage should not take the vault down.
      console.error('Rate limiter error:', err instanceof Error ? err.message : 'unknown');
      await next();
      return;
    }

    c.header('X-RateLimit-Limit', String(config.maxRequests));
    c.header('X-RateLimit-Remaining', String(Math.max(0, config.maxRequests - result.count)));
    c.header('X-RateLimit-Reset', String(result.resetIn));

    if (result.count > config.maxRequests) {
      tooManyRequests(c, result.resetIn);
    }
    await next();
  };
}

/** Per-isolate, in-memory fixed-window rate limiter. */
export function memoryRateLimit(config: Omit<RateLimitConfig, 'keyFn'>) {
  const counters = new Map<string, { windowStart: number; count: number }>();

  return async (c: AppContext, next: Next) => {
    const now = nowSeconds();
    const windowStart = now - (now % config.windowSeconds);
    const key = clientKey(c);

    const entry = counters.get(key);
    if (!entry || entry.windowStart !== windowStart) {
      counters.set(key, { windowStart, count: 1 });
      // Opportunistic cleanup so the map cannot grow without bound.
      if (counters.size > 5000) {
        for (const [k, v] of counters) {
          if (v.windowStart !== windowStart) counters.delete(k);
        }
      }
    } else {
      entry.count += 1;
      if (entry.count > config.maxRequests) {
        tooManyRequests(c, windowStart + config.windowSeconds - now);
      }
    }
    await next();
  };
}

/** Login and token exchange endpoints: 20 requests per minute per IP. */
export const authRateLimit = rateLimit({
  windowSeconds: 60,
  maxRequests: 20,
  keyPrefix: 'rl:auth',
});

/** Magic link requests: 5 per 15 minutes per IP. */
export const magicLinkRateLimit = rateLimit({
  windowSeconds: 900,
  maxRequests: 5,
  keyPrefix: 'rl:magic',
});

/** Public share link access: 30 per 5 minutes per IP. */
export const publicShareRateLimit = rateLimit({
  windowSeconds: 300,
  maxRequests: 30,
  keyPrefix: 'rl:share',
});

/** Authenticated API safety net: 300 requests per minute per user per isolate. */
export const apiRateLimit = memoryRateLimit({
  windowSeconds: 60,
  maxRequests: 300,
  keyPrefix: 'rl:api',
});
