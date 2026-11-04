/**
 * Authentication and session management.
 *
 * Tokens are HS256 JWTs whose `jti` is the id of a row in the `sessions`
 * table. The row is the source of truth for:
 *   - revocation (logout, "sign out everywhere")
 *   - idle timeout (server-enforced, per the user's preference)
 *   - absolute expiry
 *
 * Free tier budget: one D1 read per authenticated request, plus at most one
 * write per session per minute to record activity.
 */

import type { Next } from 'hono';
import * as jose from 'jose';
import type { AppContext, AuthUser } from '../env';
import { getClientIp, HttpError, nowSeconds } from '../lib/http';

/** Absolute session lifetime. */
export const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
/** Default idle timeout when the user has no preference row. */
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 15;
/** Only write last_activity_at when it is at least this stale. */
const ACTIVITY_WRITE_INTERVAL_SECONDS = 60;

interface TokenClaims {
  sub: string;
  jti: string;
  exp: number;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Create a session row and a signed token for it.
 */
export async function createSession(
  c: AppContext,
  user: AuthUser
): Promise<{ token: string; expiresAt: number }> {
  const prefs = await c.env.DB.prepare(
    'SELECT session_timeout FROM user_preferences WHERE user_id = ?'
  )
    .bind(user.id)
    .first<{ session_timeout: number }>();

  const now = nowSeconds();
  const expiresAt = now + SESSION_LIFETIME_SECONDS;
  const sessionId = crypto.randomUUID();
  const timeout = prefs?.session_timeout ?? DEFAULT_SESSION_TIMEOUT_MINUTES;

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_activity_at, timeout_minutes, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sessionId,
      user.id,
      now,
      expiresAt,
      now,
      timeout,
      getClientIp(c),
      c.req.header('User-Agent')?.slice(0, 300) ?? null
    )
    .run();

  const token = await new jose.SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setJti(sessionId)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(secretKey(c.env.JWT_SECRET));

  return { token, expiresAt };
}

/** Verify a token's signature and expiry and return its claims. */
export async function verifyToken(token: string, secret: string): Promise<TokenClaims> {
  const { payload } = await jose.jwtVerify(token, secretKey(secret), {
    algorithms: ['HS256'],
  });
  if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string' || typeof payload.exp !== 'number') {
    throw new Error('Malformed token');
  }
  return { sub: payload.sub, jti: payload.jti, exp: payload.exp };
}

/** Revoke a single session. */
export async function revokeSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').bind(sessionId).run();
}

/** Revoke every session for a user, optionally keeping one. */
export async function revokeAllSessions(
  db: D1Database,
  userId: string,
  exceptSessionId?: string
): Promise<number> {
  const result = await db
    .prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0 AND id != ?')
    .bind(userId, exceptSessionId ?? '')
    .run();
  return result.meta?.changes ?? 0;
}

/**
 * Require a valid, unrevoked, non-idle session.
 */
export async function authMiddleware(c: AppContext, next: Next) {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Unauthorized');
  }

  let claims: TokenClaims;
  try {
    claims = await verifyToken(header.slice(7), c.env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Invalid token');
  }

  const session = await c.env.DB.prepare(
    `SELECT s.id, s.expires_at, s.last_activity_at, s.timeout_minutes, s.revoked,
            u.id AS user_id, u.email, u.name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.user_id = ?`
  )
    .bind(claims.jti, claims.sub)
    .first<{
      id: string;
      expires_at: number;
      last_activity_at: number;
      timeout_minutes: number;
      revoked: number;
      user_id: string;
      email: string;
      name: string | null;
    }>();

  const now = nowSeconds();

  if (!session || session.revoked || session.expires_at <= now) {
    throw new HttpError(401, 'Session has ended', 'SESSION_ENDED');
  }

  if (session.timeout_minutes > 0 && now - session.last_activity_at > session.timeout_minutes * 60) {
    await revokeSession(c.env.DB, session.id);
    throw new HttpError(401, 'Session timed out', 'SESSION_TIMEOUT');
  }

  if (now - session.last_activity_at >= ACTIVITY_WRITE_INTERVAL_SECONDS) {
    await c.env.DB.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?')
      .bind(now, session.id)
      .run();
  }

  c.set('user', { id: session.user_id, email: session.email, name: session.name });
  c.set('session', { id: session.id, expiresAt: session.expires_at });

  await next();
}
