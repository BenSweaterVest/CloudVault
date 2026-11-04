/**
 * HTTP helpers shared by all routes.
 */

import type { AppContext, AuthUser, SessionInfo } from '../env';

/**
 * An error that maps directly to an HTTP response.
 * Thrown from route helpers and turned into JSON by the global error handler.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 429 | 500 | 503,
    message: string,
    public readonly code?: string,
    public readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** The authenticated user. Only valid after authMiddleware has run. */
export function getUser(c: AppContext): AuthUser {
  const user = c.get('user');
  if (!user) throw new HttpError(401, 'Unauthorized');
  return user;
}

/** The current session. Only valid after authMiddleware has run. */
export function getSession(c: AppContext): SessionInfo {
  const session = c.get('session');
  if (!session) throw new HttpError(401, 'Unauthorized');
  return session;
}

/** Best-effort client IP (Cloudflare sets CF-Connecting-IP). */
export function getClientIp(c: AppContext): string | null {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    null
  );
}

/** Current time in unix seconds. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** A route parameter that must be present. */
export function param(c: AppContext, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new HttpError(400, `Missing parameter: ${name}`);
  return value;
}
