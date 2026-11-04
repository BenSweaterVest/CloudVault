/**
 * Security headers and CORS origin policy.
 */

import type { Next } from 'hono';
import type { AppContext } from '../env';

function isLocalhostUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/** Adds security headers to every API response. */
export async function securityHeaders(c: AppContext, next: Next) {
  await next();

  const headers = c.res.headers;
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Resource-Policy', 'same-site');
  // API responses can contain ciphertext and personal data; never cache them.
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'no-store');
  }
  if (!isLocalhostUrl(c.env.APP_URL)) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

/**
 * CORS origin policy.
 *
 * - Production: only the exact APP_URL origin.
 * - Development (APP_URL is localhost): any localhost origin, so the Vite dev
 *   server works on any port.
 *
 * Returns null to deny.
 */
export function getCorsOrigin(origin: string | undefined, appUrl: string): string | null {
  let appOrigin: string;
  try {
    appOrigin = new URL(appUrl).origin;
  } catch {
    return null;
  }

  if (!origin) return appOrigin;
  if (origin === appOrigin) return origin;
  if (isLocalhostUrl(appUrl) && isLocalhostUrl(origin)) return origin;
  return null;
}
