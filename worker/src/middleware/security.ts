/**
 * Security Headers Middleware
 * 
 * Adds essential security headers to all responses.
 */

import { Context, Next } from 'hono';
import type { Env, Variables } from '../index';

/**
 * Security headers middleware
 * Adds CSP, X-Frame-Options, and other security headers
 */
export async function securityHeaders(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
) {
  await next();
  
  // Only add headers to successful responses
  if (c.res) {
    const headers = c.res.headers;
    
    // Prevent clickjacking
    headers.set('X-Frame-Options', 'DENY');
    
    // Prevent MIME type sniffing
    headers.set('X-Content-Type-Options', 'nosniff');
    
    // Control referrer information
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Prevent XSS attacks (legacy, but still useful)
    headers.set('X-XSS-Protection', '1; mode=block');
    
    // Content Security Policy
    // Strict CSP for API responses
    if (c.req.path.startsWith('/api')) {
      headers.set(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'"
      );
    }
    
    // Permissions Policy (formerly Feature-Policy)
    headers.set(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), interest-cohort=()'
    );
    
    // Strict Transport Security (HSTS)
    // Only in production (when not localhost)
    if (!c.env.APP_URL?.includes('localhost')) {
      headers.set(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload'
      );
    }
  }
}

/**
 * CORS configuration helper for production
 */
export function getCorsOrigin(origin: string | undefined, appUrl: string): string | null {
  // In development, allow localhost origins
  if (appUrl.includes('localhost')) {
    if (origin?.includes('localhost')) {
      return origin;
    }
  }
  
  // In production, only allow the configured APP_URL
  if (origin === appUrl) {
    return origin;
  }
  
  // Also allow same-origin requests (no origin header)
  if (!origin) {
    return appUrl;
  }
  
  return null;
}
