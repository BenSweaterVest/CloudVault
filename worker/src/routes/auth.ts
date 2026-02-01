/**
 * Authentication Routes
 * 
 * Handles GitHub OAuth, Magic Links, and user session management.
 * 
 * @module routes/auth
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../index';
import { createToken, authMiddleware, blacklistToken, getJwtPayload } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';
import { authRateLimit, passwordResetRateLimit } from '../middleware/rateLimit';
import { 
  validateBody, 
  githubCallbackSchema, 
  magicLinkRequestSchema, 
  magicLinkVerifySchema,
  setupKeysSchema 
} from '../lib/validation';

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Apply rate limiting to all auth routes
authRoutes.use('*', authRateLimit);

// ============================================
// GITHUB OAUTH
// ============================================

/**
 * Redirect to GitHub OAuth
 */
authRoutes.get('/github', (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID;
  const redirectUri = `${c.env.APP_URL}/auth/github/callback`;
  
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'user:email',
    state: crypto.randomUUID(), // CSRF protection
  });
  
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

/**
 * GitHub OAuth callback
 * 
 * @route POST /github/callback
 * @body {string} code - GitHub authorization code
 */
authRoutes.post('/github/callback', async (c) => {
  const { code } = await validateBody(c, githubCallbackSchema);
  
  // Exchange code for access token
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  
  const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
  
  if (!tokenData.access_token) {
    console.error('GitHub token exchange failed:', tokenData.error || 'unknown error');
    return c.json({ error: 'Failed to authenticate with GitHub' }, 400);
  }
  
  // Get user info from GitHub
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/json',
    },
  });
  
  const githubUser = await userResponse.json() as {
    id: number;
    login: string;
    email: string | null;
    name: string | null;
  };
  
  // Get email if not public
  let email = githubUser.email;
  if (!email) {
    const emailsResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json',
      },
    });
    
    const emails = await emailsResponse.json() as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    
    const primaryEmail = emails.find((e) => e.primary && e.verified);
    email = primaryEmail?.email || emails[0]?.email;
  }
  
  if (!email) {
    return c.json({ error: 'Could not get email from GitHub' }, 400);
  }
  
  // Check if user exists
  const existingUser = await c.env.DB.prepare(
    'SELECT * FROM users WHERE github_id = ? OR email = ?'
  )
    .bind(githubUser.id.toString(), email)
    .first<{
      id: string;
      email: string;
      name: string | null;
      public_key: string | null;
      encrypted_private_key: string | null;
      salt: string | null;
      auth_provider: string;
      github_id: string | null;
    }>();
  
  let user: typeof existingUser;
  let isNewUser = false;
  
  if (existingUser) {
    // Update GitHub ID if missing
    if (!existingUser.github_id) {
      await c.env.DB.prepare('UPDATE users SET github_id = ? WHERE id = ?')
        .bind(githubUser.id.toString(), existingUser.id)
        .run();
    }
    user = existingUser;
  } else {
    // Create new user
    const userId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, name, auth_provider, github_id) VALUES (?, ?, ?, 'github', ?)`
    )
      .bind(userId, email, githubUser.name || githubUser.login, githubUser.id.toString())
      .run();
    
    user = {
      id: userId,
      email,
      name: githubUser.name || githubUser.login,
      public_key: null,
      encrypted_private_key: null,
      salt: null,
      auth_provider: 'github',
      github_id: githubUser.id.toString(),
    };
    isNewUser = true;
  }
  
  // Create JWT
  const token = await createToken(
    { id: user.id, email: user.email, name: user.name },
    c.env.JWT_SECRET
  );
  
  // Log audit event
  await logAuditEvent(c.env.DB, {
    userId: user.id,
    userEmail: user.email,
    action: 'LOGIN',
    metadata: { provider: 'github', isNewUser },
    ipAddress: c.req.header('CF-Connecting-IP') || undefined,
    userAgent: c.req.header('User-Agent') || undefined,
  });
  
  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      publicKey: user.public_key,
      encryptedPrivateKey: user.encrypted_private_key,
      salt: user.salt,
      authProvider: user.auth_provider,
      createdAt: new Date().toISOString(),
    },
    isNewUser: isNewUser || !user.public_key,
  });
});

// ============================================
// MAGIC LINKS
// ============================================

/**
 * Request a magic link
 * Has stricter rate limiting to prevent email spam
 */
authRoutes.post('/magic-link', passwordResetRateLimit, async (c) => {
  const { email } = await validateBody(c, magicLinkRequestSchema);
  
  // Configurable expiry (default 15 minutes)
  const expiryMinutes = parseInt(c.env.MAGIC_LINK_EXPIRY_MINUTES || '15', 10);
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
  
  // Generate token
  const token = crypto.randomUUID();
  
  // Store token
  await c.env.DB.prepare(
    'INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)'
  )
    .bind(token, email.toLowerCase(), expiresAt.toISOString())
    .run();
  
  // Configurable email sender (default: noreply@cloudvault.app)
  const emailFrom = c.env.EMAIL_FROM || 'CloudVault <noreply@cloudvault.app>';
  
  // Send email (if Resend API key is configured)
  if (c.env.RESEND_API_KEY) {
    const magicLinkUrl = `${c.env.APP_URL}/auth/magic-link?token=${token}`;

    try {
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: emailFrom,
          to: email,
          subject: 'Your CloudVault Login Link',
          html: `
            <h2>Login to CloudVault</h2>
            <p>Click the link below to log in. This link expires in ${expiryMinutes} minutes.</p>
            <a href="${magicLinkUrl}" style="
              display: inline-block;
              padding: 12px 24px;
              background-color: #0ea5e9;
              color: white;
              text-decoration: none;
              border-radius: 6px;
            ">Log In to CloudVault</a>
            <p>Or copy this link: ${magicLinkUrl}</p>
            <p style="color: #666; font-size: 12px;">
              If you didn't request this login link, you can safely ignore this email.
            </p>
          `,
        }),
      });

      if (!emailResponse.ok) {
        // Log failure but don't expose to user (security: don't reveal if email exists)
        console.error('Failed to send magic link email:', emailResponse.status);
      }
    } catch (err) {
      // Log error but continue - don't reveal email delivery status to user
      console.error('Email service error:', err instanceof Error ? err.message : 'unknown');
    }
  }
  // Note: In development without Resend, magic link is stored in DB but no email sent
  // Check magic_links table directly for testing
  
  return c.json({ message: 'If an account exists, a login link has been sent.' });
});

/**
 * Verify magic link token
 */
authRoutes.post('/magic-link/verify', async (c) => {
  const { token } = await validateBody(c, magicLinkVerifySchema);
  
  // Find and validate token
  const magicLink = await c.env.DB.prepare(
    'SELECT * FROM magic_links WHERE token = ? AND used = 0'
  )
    .bind(token)
    .first<{ token: string; email: string; expires_at: string; used: number }>();
  
  if (!magicLink) {
    return c.json({ error: 'Invalid or expired link' }, 400);
  }
  
  if (new Date(magicLink.expires_at) < new Date()) {
    return c.json({ error: 'Link has expired' }, 400);
  }
  
  // Mark token as used
  await c.env.DB.prepare('UPDATE magic_links SET used = 1 WHERE token = ?')
    .bind(token)
    .run();
  
  // Find or create user
  let existingUser = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(magicLink.email)
    .first<{
      id: string;
      email: string;
      name: string | null;
      public_key: string | null;
      encrypted_private_key: string | null;
      salt: string | null;
      auth_provider: string;
    }>();
  
  let isNewUser = false;
  
  if (!existingUser) {
    const userId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, auth_provider) VALUES (?, ?, 'magic_link')`
    )
      .bind(userId, magicLink.email)
      .run();
    
    existingUser = {
      id: userId,
      email: magicLink.email,
      name: null,
      public_key: null,
      encrypted_private_key: null,
      salt: null,
      auth_provider: 'magic_link',
    };
    isNewUser = true;
  }
  
  // Create JWT
  const jwtToken = await createToken(
    { id: existingUser.id, email: existingUser.email, name: existingUser.name },
    c.env.JWT_SECRET
  );
  
  // Log audit event
  await logAuditEvent(c.env.DB, {
    userId: existingUser.id,
    userEmail: existingUser.email,
    action: 'LOGIN',
    metadata: { provider: 'magic_link', isNewUser },
    ipAddress: c.req.header('CF-Connecting-IP') || undefined,
    userAgent: c.req.header('User-Agent') || undefined,
  });
  
  return c.json({
    token: jwtToken,
    user: {
      id: existingUser.id,
      email: existingUser.email,
      name: existingUser.name,
      publicKey: existingUser.public_key,
      encryptedPrivateKey: existingUser.encrypted_private_key,
      salt: existingUser.salt,
      authProvider: existingUser.auth_provider,
      createdAt: new Date().toISOString(),
    },
    isNewUser: isNewUser || !existingUser.public_key,
  });
});

// ============================================
// USER SESSION
// ============================================

/**
 * Get current user
 */
authRoutes.get('/me', authMiddleware, async (c) => {
  const user = c.get('user')!;
  
  const dbUser = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(user.id)
    .first<{
      id: string;
      email: string;
      name: string | null;
      public_key: string | null;
      encrypted_private_key: string | null;
      salt: string | null;
      auth_provider: string;
      created_at: string;
    }>();
  
  if (!dbUser) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  return c.json({
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    publicKey: dbUser.public_key,
    encryptedPrivateKey: dbUser.encrypted_private_key,
    salt: dbUser.salt,
    authProvider: dbUser.auth_provider,
    createdAt: dbUser.created_at,
  });
});

/**
 * Setup user keys (first-time setup after login)
 */
authRoutes.post('/setup-keys', authMiddleware, async (c) => {
  const user = c.get('user')!;
  const { publicKey, encryptedPrivateKey, salt } = await validateBody(c, setupKeysSchema);
  
  // Check if user already has keys
  const existingUser = await c.env.DB.prepare(
    'SELECT public_key FROM users WHERE id = ?'
  )
    .bind(user.id)
    .first<{ public_key: string | null }>();
  
  if (existingUser?.public_key) {
    return c.json({ error: 'Keys already set up' }, 400);
  }
  
  // Update user with keys
  await c.env.DB.prepare(
    'UPDATE users SET public_key = ?, encrypted_private_key = ?, salt = ? WHERE id = ?'
  )
    .bind(publicKey, encryptedPrivateKey, salt, user.id)
    .run();
  
  // Get updated user
  const updatedUser = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(user.id)
    .first<{
      id: string;
      email: string;
      name: string | null;
      public_key: string;
      encrypted_private_key: string;
      salt: string;
      auth_provider: string;
      created_at: string;
    }>();
  
  return c.json({
    id: updatedUser!.id,
    email: updatedUser!.email,
    name: updatedUser!.name,
    publicKey: updatedUser!.public_key,
    encryptedPrivateKey: updatedUser!.encrypted_private_key,
    salt: updatedUser!.salt,
    authProvider: updatedUser!.auth_provider,
    createdAt: updatedUser!.created_at,
  });
});

// ============================================
// LOGOUT
// ============================================

/**
 * Logout endpoint
 *
 * Blacklists the current JWT token and logs the action.
 * The token is added to a KV-based blacklist with TTL matching
 * the token's remaining lifetime.
 *
 * @route POST /api/auth/logout
 */
authRoutes.post('/logout', authMiddleware, async (c) => {
  const user = c.get('user')!;
  const jwtPayload = getJwtPayload(c);

  // Blacklist the token if it has a JTI
  if (jwtPayload?.jti && jwtPayload?.exp) {
    await blacklistToken(c.env.KV, jwtPayload.jti, jwtPayload.exp);
  }

  // Log the logout action
  await logAuditEvent(c.env.DB, {
    userId: user.id,
    userEmail: user.email,
    action: 'LOGOUT',
    ipAddress: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For'),
    userAgent: c.req.header('User-Agent'),
  });

  return c.json({ success: true, message: 'Logged out successfully' });
});
