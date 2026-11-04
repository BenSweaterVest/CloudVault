/**
 * Authentication routes: GitHub OAuth, magic links, sessions and the user's
 * own key material.
 *
 * Mounted at /api/auth.
 */

import { Hono } from 'hono';
import type { AppContext, AppEnv } from '../env';
import { authMiddleware, createSession, revokeAllSessions, revokeSession } from '../middleware/auth';
import { createAuditLogger, logAuditEvent } from '../middleware/audit';
import { authRateLimit, hitCounter, magicLinkRateLimit } from '../middleware/rateLimit';
import { getClientIp, getSession, getUser, HttpError, nowSeconds } from '../lib/http';
import { randomToken, sha256Hex } from '../lib/crypto';
import { emailButton, emailLayout, sendEmail } from '../lib/email';
import {
  changeMasterPasswordSchema,
  githubCallbackSchema,
  magicLinkRequestSchema,
  magicLinkVerifySchema,
  setupKeysSchema,
  updateProfileSchema,
  validateBody,
} from '../lib/validation';

export const authRoutes = new Hono<AppEnv>();

authRoutes.use('*', authRateLimit);

// ============================================
// SHARED HELPERS
// ============================================

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  public_key: string | null;
  encrypted_private_key: string | null;
  salt: string | null;
  kdf_iterations: number;
  auth_provider: string;
  github_id: string | null;
  created_at: string;
}

export function serializeUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    publicKey: u.public_key,
    encryptedPrivateKey: u.encrypted_private_key,
    salt: u.salt,
    kdfIterations: u.kdf_iterations,
    authProvider: u.auth_provider,
    createdAt: u.created_at,
  };
}

async function getUserRow(db: D1Database, userId: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRow>();
}

function signupsAllowed(c: AppContext): boolean {
  return c.env.ALLOW_SIGNUPS !== 'false';
}

/** Create a session for `user` and build the standard login response. */
async function completeLogin(c: AppContext, user: UserRow, provider: string, isNewAccount: boolean) {
  const { token, expiresAt } = await createSession(c, { id: user.id, email: user.email, name: user.name });

  await logAuditEvent(c.env.DB, {
    userId: user.id,
    userEmail: user.email,
    action: 'LOGIN',
    metadata: { provider, isNewAccount },
    ipAddress: getClientIp(c),
    userAgent: c.req.header('User-Agent'),
  });

  return c.json({
    token,
    expiresAt,
    user: serializeUser(user),
    needsKeySetup: !user.public_key,
  });
}

// ============================================
// CONFIGURATION
// ============================================

/** Which sign-in methods this deployment offers (for the login screen). */
authRoutes.get('/config', (c) => {
  return c.json({
    github: !!(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET),
    // Without Resend, links are only printed to the log, which is useful in development.
    magicLink: !!c.env.RESEND_API_KEY || c.env.ENVIRONMENT !== 'production',
    signupsAllowed: signupsAllowed(c),
  });
});

function requireGitHub(c: AppContext): { clientId: string; clientSecret: string } {
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) {
    throw new HttpError(503, 'GitHub sign-in is not configured on this server');
  }
  return { clientId: c.env.GITHUB_CLIENT_ID, clientSecret: c.env.GITHUB_CLIENT_SECRET };
}

// ============================================
// GITHUB OAUTH
// ============================================

/**
 * Start GitHub OAuth.
 *
 * The frontend generates a random `state`, stores it in sessionStorage and
 * navigates here. The callback page compares the returned state with the
 * stored one before exchanging the code, which prevents login CSRF.
 */
authRoutes.get('/github', (c) => {
  const { clientId } = requireGitHub(c);
  const state = c.req.query('state') ?? '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) {
    throw new HttpError(400, 'Missing or invalid state parameter');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${new URL(c.env.APP_URL).origin}/auth/github/callback`,
    scope: 'read:user user:email',
    state,
    allow_signup: 'true',
  });
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

authRoutes.post('/github/callback', async (c) => {
  const { clientId, clientSecret } = requireGitHub(c);
  const { code } = await validateBody(c, githubCallbackSchema);

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });
  const tokenData = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    console.error('GitHub token exchange failed:', tokenData.error ?? 'unknown error');
    throw new HttpError(400, 'Failed to authenticate with GitHub');
  }

  const ghHeaders = {
    Authorization: `Bearer ${tokenData.access_token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CloudVault',
  };

  const [userResponse, emailsResponse] = await Promise.all([
    fetch('https://api.github.com/user', { headers: ghHeaders }),
    fetch('https://api.github.com/user/emails', { headers: ghHeaders }),
  ]);
  if (!userResponse.ok || !emailsResponse.ok) {
    throw new HttpError(400, 'Failed to read GitHub profile');
  }

  const githubUser = (await userResponse.json()) as { id: number; login: string; name: string | null };
  const emails = (await emailsResponse.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;

  // Only a verified primary address proves ownership. An unverified address
  // must never be used to find (and so take over) an existing account.
  const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : undefined;
  if (!primary) {
    throw new HttpError(400, 'Your GitHub account needs a verified primary email address');
  }
  const email = primary.email.toLowerCase();
  const githubId = String(githubUser.id);
  const displayName = githubUser.name || githubUser.login;

  let user = await c.env.DB.prepare('SELECT * FROM users WHERE github_id = ?').bind(githubId).first<UserRow>();
  let isNewAccount = false;

  if (!user) {
    const byEmail = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
    if (byEmail) {
      if (byEmail.github_id && byEmail.github_id !== githubId) {
        throw new HttpError(409, 'This email is already linked to a different GitHub account');
      }
      // Same verified email: link this GitHub account to the existing user.
      await c.env.DB.prepare('UPDATE users SET github_id = ?, name = COALESCE(name, ?) WHERE id = ?')
        .bind(githubId, displayName, byEmail.id)
        .run();
      user = await getUserRow(c.env.DB, byEmail.id);
    } else {
      if (!signupsAllowed(c)) {
        throw new HttpError(403, 'Sign-ups are disabled. Ask an administrator to invite you.');
      }
      const userId = crypto.randomUUID();
      await c.env.DB.prepare(
        "INSERT INTO users (id, email, name, auth_provider, github_id) VALUES (?, ?, ?, 'github', ?)"
      )
        .bind(userId, email, displayName, githubId)
        .run();
      user = await getUserRow(c.env.DB, userId);
      isNewAccount = true;
    }
  }

  if (!user) throw new HttpError(500, 'Failed to load user');
  return completeLogin(c, user, 'github', isNewAccount);
});

// ============================================
// MAGIC LINKS
// ============================================

const GENERIC_MAGIC_LINK_RESPONSE = { message: 'If this address can sign in, a login link has been sent.' };

authRoutes.post('/magic-link', magicLinkRateLimit, async (c) => {
  const { email } = await validateBody(c, magicLinkRequestSchema);

  // Per-address limit, so one inbox cannot be flooded from many IPs. Excess
  // requests get the same generic response.
  const perEmail = await hitCounter(c.env.DB, `rl:magic-email:${await sha256Hex(email)}`, 900);
  if (perEmail.count > 3) return c.json(GENERIC_MAGIC_LINK_RESPONSE);

  if (!signupsAllowed(c)) {
    const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
    if (!exists) return c.json(GENERIC_MAGIC_LINK_RESPONSE);
  }

  const expiryMinutes = Math.min(Math.max(parseInt(c.env.MAGIC_LINK_EXPIRY_MINUTES || '15', 10) || 15, 5), 60);
  const expiresAt = new Date(Date.now() + expiryMinutes * 60_000).toISOString();
  const token = randomToken(32);

  // Only the hash is stored, so a database leak does not expose live links.
  await c.env.DB.prepare('INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), email, expiresAt)
    .run();

  // The token travels in the URL fragment, which browsers never send to servers.
  const link = `${new URL(c.env.APP_URL).origin}/auth/magic-link#token=${token}`;
  const sent = await sendEmail(c.env, {
    to: email,
    subject: 'Your CloudVault login link',
    html: emailLayout(
      'Log in to CloudVault',
      `<p>Use the button below to log in. The link expires in ${expiryMinutes} minutes and works once.</p>${emailButton('Log in to CloudVault', link)}`
    ),
  });

  if (!sent && c.env.ENVIRONMENT !== 'production') {
    // Local development without Resend: print the link so it can be used.
    console.log(`[dev] Magic link for ${email}: ${link}`);
  }

  return c.json(GENERIC_MAGIC_LINK_RESPONSE);
});

authRoutes.post('/magic-link/verify', async (c) => {
  const { token } = await validateBody(c, magicLinkVerifySchema);
  const tokenHash = await sha256Hex(token);

  // Consume atomically: of two concurrent requests, only one gets a row back.
  const consumed = await c.env.DB.prepare(
    'UPDATE magic_links SET used = 1 WHERE token = ? AND used = 0 AND expires_at > ? RETURNING email'
  )
    .bind(tokenHash, new Date().toISOString())
    .first<{ email: string }>();

  if (!consumed) throw new HttpError(400, 'This login link is invalid or has expired');

  let user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(consumed.email).first<UserRow>();
  let isNewAccount = false;
  if (!user) {
    if (!signupsAllowed(c)) throw new HttpError(403, 'Sign-ups are disabled');
    const userId = crypto.randomUUID();
    await c.env.DB.prepare("INSERT INTO users (id, email, auth_provider) VALUES (?, ?, 'magic_link')")
      .bind(userId, consumed.email)
      .run();
    user = await getUserRow(c.env.DB, userId);
    isNewAccount = true;
  }

  if (!user) throw new HttpError(500, 'Failed to load user');
  return completeLogin(c, user, 'magic_link', isNewAccount);
});

// ============================================
// CURRENT USER
// ============================================

authRoutes.get('/me', authMiddleware, async (c) => {
  const user = await getUserRow(c.env.DB, getUser(c).id);
  if (!user) throw new HttpError(404, 'User not found');
  return c.json(serializeUser(user));
});

authRoutes.patch('/me', authMiddleware, async (c) => {
  const { id } = getUser(c);
  const { name } = await validateBody(c, updateProfileSchema);
  await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, id).run();
  createAuditLogger(c).log('UPDATE_PROFILE', { targetType: 'user', targetId: id });
  const user = await getUserRow(c.env.DB, id);
  if (!user) throw new HttpError(404, 'User not found');
  return c.json(serializeUser(user));
});

/** First-time key setup after the user picks a master password. */
authRoutes.post('/setup-keys', authMiddleware, async (c) => {
  const { id } = getUser(c);
  const data = await validateBody(c, setupKeysSchema);

  // Only succeeds if no key is set yet, even under concurrent requests.
  const result = await c.env.DB.prepare(
    'UPDATE users SET public_key = ?, encrypted_private_key = ?, salt = ?, kdf_iterations = ? WHERE id = ? AND public_key IS NULL'
  )
    .bind(data.publicKey, data.encryptedPrivateKey, data.salt, data.kdfIterations, id)
    .run();

  if (!result.meta?.changes) throw new HttpError(409, 'Keys are already set up');

  createAuditLogger(c).log('SETUP_KEYS', { targetType: 'user', targetId: id });
  const user = await getUserRow(c.env.DB, id);
  if (!user) throw new HttpError(404, 'User not found');
  return c.json(serializeUser(user));
});

/**
 * Change master password: the client re-encrypts the same private key under a
 * new password. The public key does not change, so org access is unaffected.
 * Every other session is signed out.
 */
authRoutes.put('/keys', authMiddleware, async (c) => {
  const { id } = getUser(c);
  const session = getSession(c);
  const data = await validateBody(c, changeMasterPasswordSchema);

  const result = await c.env.DB.prepare(
    'UPDATE users SET encrypted_private_key = ?, salt = ?, kdf_iterations = ? WHERE id = ? AND public_key IS NOT NULL'
  )
    .bind(data.encryptedPrivateKey, data.salt, data.kdfIterations, id)
    .run();
  if (!result.meta?.changes) throw new HttpError(409, 'Keys have not been set up yet');

  const revoked = await revokeAllSessions(c.env.DB, id, session.id);
  createAuditLogger(c).log('CHANGE_MASTER_PASSWORD', {
    targetType: 'user',
    targetId: id,
    metadata: { kdfIterations: data.kdfIterations, sessionsRevoked: revoked },
  });

  const user = await getUserRow(c.env.DB, id);
  if (!user) throw new HttpError(404, 'User not found');
  return c.json(serializeUser(user));
});

// ============================================
// LOGOUT
// ============================================

authRoutes.post('/logout', authMiddleware, async (c) => {
  await revokeSession(c.env.DB, getSession(c).id);
  createAuditLogger(c).log('LOGOUT');
  return c.json({ success: true });
});

authRoutes.post('/logout-all', authMiddleware, async (c) => {
  const user = getUser(c);
  const count = await revokeAllSessions(c.env.DB, user.id);
  createAuditLogger(c).log('LOGOUT_ALL', { metadata: { sessionsRevoked: count } });
  return c.json({ success: true, sessionsRevoked: count });
});

/** Absolute session expiry, for the client to schedule re-login prompts. */
authRoutes.get('/session', authMiddleware, (c) => {
  const session = getSession(c);
  return c.json({ expiresAt: session.expiresAt, now: nowSeconds() });
});
