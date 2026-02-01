/**
 * Distributed Rate Limiting Middleware
 *
 * Uses Cloudflare KV for distributed rate limiting across all edge locations.
 * This ensures rate limits are enforced globally, not per-isolate.
 */

import { Context, Next } from 'hono';
import type { Env, Variables } from '../index';

interface RateLimitConfig {
  /** Time window in seconds */
  windowSeconds: number;
  /** Maximum requests allowed per window */
  maxRequests: number;
  /** Key prefix for KV storage */
  keyPrefix: string;
}

/**
 * Get client identifier for rate limiting
 */
function getClientKey(c: Context<{ Bindings: Env; Variables: Variables }>): string {
  const user = c.get('user');
  if (user?.id) {
    return `user:${user.id}`;
  }

  const ip = c.req.header('CF-Connecting-IP') ||
             c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
             'unknown';
  return `ip:${ip}`;
}

/**
 * Create a distributed rate limiting middleware using Cloudflare KV
 */
export function rateLimit(config: RateLimitConfig) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    const clientKey = getClientKey(c);
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % config.windowSeconds);
    const kvKey = `${config.keyPrefix}:${clientKey}:${windowStart}`;

    // Get current count from KV
    const currentValue = await c.env.KV.get(kvKey);
    const currentCount = currentValue ? parseInt(currentValue, 10) : 0;

    // Calculate remaining requests and reset time
    const remaining = Math.max(0, config.maxRequests - currentCount - 1);
    const resetAt = windowStart + config.windowSeconds;
    const resetIn = resetAt - now;

    // Set rate limit headers
    c.header('X-RateLimit-Limit', config.maxRequests.toString());
    c.header('X-RateLimit-Remaining', remaining.toString());
    c.header('X-RateLimit-Reset', resetIn.toString());

    // Check if rate limit exceeded
    if (currentCount >= config.maxRequests) {
      c.header('Retry-After', resetIn.toString());
      return c.json(
        {
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again in ${resetIn} seconds.`,
          retryAfter: resetIn,
        },
        429
      );
    }

    // Increment counter in KV with TTL matching the window
    await c.env.KV.put(kvKey, (currentCount + 1).toString(), {
      expirationTtl: config.windowSeconds + 10, // Add buffer for clock skew
    });

    await next();
  };
}

/**
 * Pre-configured rate limiters for different endpoints
 */

/** Strict rate limit for auth endpoints (10 requests per minute) */
export const authRateLimit = rateLimit({
  windowSeconds: 60,
  maxRequests: 10,
  keyPrefix: 'rl:auth',
});

/** Moderate rate limit for general API endpoints (100 requests per minute) */
export const apiRateLimit = rateLimit({
  windowSeconds: 60,
  maxRequests: 100,
  keyPrefix: 'rl:api',
});

/** Very strict rate limit for magic link requests (5 per 15 minutes) */
export const passwordResetRateLimit = rateLimit({
  windowSeconds: 900, // 15 minutes
  maxRequests: 5,
  keyPrefix: 'rl:magic',
});
