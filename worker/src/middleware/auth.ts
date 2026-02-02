/**
 * Authentication Middleware
 *
 * Validates JWT tokens, checks blacklist, enforces session timeout,
 * and attaches user info to context.
 */

import { Context, Next } from 'hono';
import * as jose from 'jose';
import type { Env, Variables } from '../index';

/** Default session timeout in minutes if no preference is set */
const DEFAULT_SESSION_TIMEOUT_MINUTES = 15;

export interface JWTPayload {
  sub: string;  // user id
  email: string;
  name: string | null;
  iat: number;
  exp: number;
  jti?: string; // JWT ID for blacklist tracking
  sessionTimeout?: number; // Session timeout in minutes (cached from user preferences)
}

/**
 * Generate a unique JWT ID
 */
function generateJti(): string {
  return crypto.randomUUID();
}

/**
 * Create a JWT token for a user
 */
export async function createToken(
  user: { id: string; email: string; name: string | null },
  secret: string,
  sessionTimeout?: number
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  const jti = generateJti();

  const payload: Record<string, unknown> = {
    sub: user.id,
    email: user.email,
    name: user.name,
    jti,
  };

  // Include session timeout in JWT to avoid DB query on every request
  if (sessionTimeout !== undefined) {
    payload.sessionTimeout = sessionTimeout;
  }

  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey);
}

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(
  token: string,
  secret: string
): Promise<JWTPayload> {
  const secretKey = new TextEncoder().encode(secret);

  const { payload } = await jose.jwtVerify(token, secretKey);

  return {
    sub: payload.sub as string,
    email: payload.email as string,
    name: payload.name as string | null,
    iat: payload.iat as number,
    exp: payload.exp as number,
    jti: payload.jti as string | undefined,
  };
}

/**
 * Check if a token is blacklisted
 */
async function isTokenBlacklisted(kv: KVNamespace, jti: string): Promise<boolean> {
  const blacklisted = await kv.get(`blacklist:${jti}`);
  return blacklisted !== null;
}

/**
 * Add a token to the blacklist
 * TTL is set to match remaining token lifetime
 */
export async function blacklistToken(
  kv: KVNamespace,
  jti: string,
  expiresAt: number
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(0, expiresAt - now);

  if (ttl > 0) {
    await kv.put(`blacklist:${jti}`, '1', { expirationTtl: ttl });
  }
}

/**
 * Update last activity timestamp for a user session
 */
async function updateLastActivity(kv: KVNamespace, userId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // TTL of 24 hours - activity records auto-expire
  await kv.put(`activity:${userId}`, now.toString(), { expirationTtl: 86400 });
}

/**
 * Check if session has timed out based on user preferences
 * Now uses cached timeout from JWT to avoid DB query on every request
 */
async function isSessionTimedOut(
  kv: KVNamespace,
  userId: string,
  cachedTimeoutMinutes?: number
): Promise<boolean> {
  // Use cached timeout from JWT, or default if not available
  const timeoutMinutes = cachedTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES;

  // If timeout is 0, session never times out
  if (timeoutMinutes === 0) {
    return false;
  }

  // Get last activity
  const lastActivityStr = await kv.get(`activity:${userId}`);
  if (!lastActivityStr) {
    // No activity recorded - session is fresh, not timed out
    return false;
  }

  const lastActivity = parseInt(lastActivityStr, 10);
  const now = Math.floor(Date.now() / 1000);
  const timeoutSeconds = timeoutMinutes * 60;

  return (now - lastActivity) > timeoutSeconds;
}

/**
 * Auth middleware - requires valid JWT that is not blacklisted and not timed out
 */
export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);

    // Check if token is blacklisted
    if (payload.jti) {
      const blacklisted = await isTokenBlacklisted(c.env.KV, payload.jti);
      if (blacklisted) {
        return c.json({ error: 'Token has been revoked' }, 401);
      }
    }

    // Check session timeout (using cached value from JWT)
    const timedOut = await isSessionTimedOut(c.env.KV, payload.sub, payload.sessionTimeout);
    if (timedOut) {
      return c.json({ error: 'Session timed out', code: 'SESSION_TIMEOUT' }, 401);
    }

    // Update last activity timestamp
    await updateLastActivity(c.env.KV, payload.sub);

    // Store token info for potential logout
    c.set('user', {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
    });

    // Store full payload for logout to access jti and exp
    (c as Context & { jwtPayload?: JWTPayload }).jwtPayload = payload;

    await next();
  } catch (err) {
    console.error('JWT verification failed:', err);
    return c.json({ error: 'Invalid token' }, 401);
  }
}

/**
 * Optional auth middleware - attaches user if token present, but doesn't require it
 */
export async function optionalAuthMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
) {
  const authHeader = c.req.header('Authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    try {
      const payload = await verifyToken(token, c.env.JWT_SECRET);

      // Check blacklist for optional auth too
      if (payload.jti) {
        const blacklisted = await isTokenBlacklisted(c.env.KV, payload.jti);
        if (!blacklisted) {
          c.set('user', {
            id: payload.sub,
            email: payload.email,
            name: payload.name,
          });
        }
      } else {
        c.set('user', {
          id: payload.sub,
          email: payload.email,
          name: payload.name,
        });
      }
    } catch {
      // Ignore invalid tokens for optional auth
    }
  }

  await next();
}

/**
 * Get JWT payload from context (for logout)
 */
export function getJwtPayload(c: Context): JWTPayload | undefined {
  return (c as Context & { jwtPayload?: JWTPayload }).jwtPayload;
}
