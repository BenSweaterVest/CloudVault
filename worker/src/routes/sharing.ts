/**
 * Secure Sharing Routes
 * 
 * Allows creating temporary, expiring share links for secrets.
 * Share links can be password-protected and view-limited.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../index';
import { authMiddleware } from '../middleware/auth';
import { createAuditLogger } from '../middleware/audit';
import { z } from 'zod';
import { validateBody } from '../lib/validation';

export const sharingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const createShareLinkSchema = z.object({
  expiresInHours: z.number().int().min(1).max(168), // 1 hour to 1 week
  maxViews: z.number().int().min(0).max(100).default(1), // 0 = unlimited
  accessPassword: z.string().min(4).max(100).optional(),
  allowCopy: z.boolean().default(true),
  recipientEmail: z.string().email().optional(),
});

// Schema for accessing share links (currently unused but kept for future feature)
// const accessShareLinkSchema = z.object({
//   password: z.string().optional(),
// });

// ============================================
// PASSWORD HASHING HELPERS
// ============================================

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;

/**
 * Hash a share link password using PBKDF2 with a random salt
 * Returns: salt:hash (both base64 encoded)
 */
async function hashSharePassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  
  const saltBase64 = btoa(String.fromCharCode(...salt));
  const hashBase64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
  
  return `${saltBase64}:${hashBase64}`;
}

/**
 * Verify a password against a stored hash
 */
async function verifySharePassword(password: string, storedHash: string): Promise<boolean> {
  // Handle legacy unsalted hashes (backwards compatibility)
  if (!storedHash.includes(':')) {
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', passwordData);
    const legacyHash = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
    return legacyHash === storedHash;
  }
  
  const [saltBase64, expectedHashBase64] = storedHash.split(':');
  const salt = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0));
  
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  
  const actualHashBase64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
  
  return actualHashBase64 === expectedHashBase64;
}

// ============================================
// AUTHENTICATED ROUTES (Create/Manage)
// ============================================

// Create a share link for a secret
sharingRoutes.post(
  '/:orgId/secrets/:secretId/share',
  authMiddleware,
  async (c) => {
    const user = c.get('user')!;
    const orgId = c.req.param('orgId');
    const secretId = c.req.param('secretId');
    const audit = createAuditLogger(c);

    // Check membership and that user has write access
    const membership = await c.env.DB.prepare(
      'SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND status = ?'
    )
      .bind(user.id, orgId, 'active')
      .first<{ role: string }>();

    if (!membership || membership.role === 'read_only') {
      return c.json({ error: 'Write access required to create share links' }, 403);
    }

    // Check org settings allow share links
    const orgSettings = await c.env.DB.prepare(
      'SELECT allow_share_links, share_link_max_hours FROM organization_settings WHERE org_id = ?'
    )
      .bind(orgId)
      .first<{ allow_share_links: number; share_link_max_hours: number }>();

    if (orgSettings && !orgSettings.allow_share_links) {
      return c.json({ error: 'Share links are disabled for this organization' }, 403);
    }

    // Verify secret exists and belongs to org
    const secret = await c.env.DB.prepare(
      'SELECT id, name FROM secrets WHERE id = ? AND org_id = ?'
    )
      .bind(secretId, orgId)
      .first<{ id: string; name: string }>();

    if (!secret) {
      return c.json({ error: 'Secret not found' }, 404);
    }

    const data = await validateBody(c, createShareLinkSchema);

    // Enforce org max hours if set
    const maxHours = orgSettings?.share_link_max_hours || 168;
    if (data.expiresInHours > maxHours) {
      return c.json({ error: `Share links cannot exceed ${maxHours} hours for this organization` }, 400);
    }

    const linkId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + data.expiresInHours * 60 * 60 * 1000).toISOString();

    // Hash password with salt if provided (PBKDF2)
    let passwordHash: string | null = null;
    if (data.accessPassword) {
      passwordHash = await hashSharePassword(data.accessPassword);
    }

    await c.env.DB.prepare(`
      INSERT INTO share_links (
        id, secret_id, org_id, created_by, access_password_hash,
        expires_at, max_views, allow_copy, recipient_email
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        linkId,
        secretId,
        orgId,
        user.id,
        passwordHash,
        expiresAt,
        data.maxViews,
        data.allowCopy ? 1 : 0,
        data.recipientEmail || null
      )
      .run();

    // Log share creation
    audit.log('CREATE_SHARE_LINK', {
      orgId,
      targetType: 'secret',
      targetId: secretId,
      targetName: secret.name,
      metadata: {
        shareId: linkId,
        expiresAt,
        maxViews: data.maxViews,
        hasPassword: !!passwordHash,
        recipientEmail: data.recipientEmail,
      },
    });

    // Generate share URL
    const shareUrl = `${c.env.APP_URL}/share/${linkId}`;

    return c.json({
      id: linkId,
      url: shareUrl,
      expiresAt,
      maxViews: data.maxViews,
      hasPassword: !!passwordHash,
      allowCopy: data.allowCopy,
      recipientEmail: data.recipientEmail,
    });
  }
);

// List share links for a secret
sharingRoutes.get(
  '/:orgId/secrets/:secretId/shares',
  authMiddleware,
  async (c) => {
    const user = c.get('user')!;
    const orgId = c.req.param('orgId');
    const secretId = c.req.param('secretId');

    // Check membership
    const membership = await c.env.DB.prepare(
      'SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND status = ?'
    )
      .bind(user.id, orgId, 'active')
      .first<{ role: string }>();

    if (!membership) {
      return c.json({ error: 'Access denied' }, 403);
    }

    const results = await c.env.DB.prepare(`
      SELECT 
        sl.*,
        u.email as created_by_email
      FROM share_links sl
      JOIN users u ON sl.created_by = u.id
      WHERE sl.secret_id = ? AND sl.org_id = ?
      ORDER BY sl.created_at DESC
    `)
      .bind(secretId, orgId)
      .all<{
        id: string;
        expires_at: string;
        max_views: number;
        view_count: number;
        allow_copy: number;
        recipient_email: string | null;
        revoked: number;
        created_at: string;
        last_viewed_at: string | null;
        created_by_email: string;
        access_password_hash: string | null;
      }>();

    return c.json(
      results.results.map((link) => ({
        id: link.id,
        url: `${c.env.APP_URL}/share/${link.id}`,
        expiresAt: link.expires_at,
        maxViews: link.max_views,
        viewCount: link.view_count,
        allowCopy: link.allow_copy === 1,
        recipientEmail: link.recipient_email,
        isRevoked: link.revoked === 1,
        isExpired: new Date(link.expires_at) < new Date(),
        isExhausted: link.max_views > 0 && link.view_count >= link.max_views,
        hasPassword: !!link.access_password_hash,
        createdAt: link.created_at,
        lastViewedAt: link.last_viewed_at,
        createdByEmail: link.created_by_email,
      }))
    );
  }
);

// Revoke a share link
sharingRoutes.delete(
  '/:orgId/shares/:linkId',
  authMiddleware,
  async (c) => {
    const user = c.get('user')!;
    const orgId = c.req.param('orgId');
    const linkId = c.req.param('linkId');
    const audit = createAuditLogger(c);

    // Check membership
    const membership = await c.env.DB.prepare(
      'SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND status = ?'
    )
      .bind(user.id, orgId, 'active')
      .first<{ role: string }>();

    if (!membership || membership.role === 'read_only') {
      return c.json({ error: 'Write access required' }, 403);
    }

    // Get link details for audit
    const link = await c.env.DB.prepare(`
      SELECT sl.*, s.name as secret_name
      FROM share_links sl
      JOIN secrets s ON sl.secret_id = s.id
      WHERE sl.id = ? AND sl.org_id = ?
    `)
      .bind(linkId, orgId)
      .first<{ id: string; secret_id: string; secret_name: string }>();

    if (!link) {
      return c.json({ error: 'Share link not found' }, 404);
    }

    await c.env.DB.prepare('UPDATE share_links SET revoked = 1 WHERE id = ?')
      .bind(linkId)
      .run();

    audit.log('REVOKE_SHARE_LINK', {
      orgId,
      targetType: 'secret',
      targetId: link.secret_id,
      targetName: link.secret_name,
      metadata: { shareId: linkId },
    });

    return c.json({ success: true });
  }
);

// ============================================
// PUBLIC ROUTES (Access Share Link)
// ============================================

// Get share link info (public, no auth required)
sharingRoutes.get('/public/:linkId', async (c) => {
  const linkId = c.req.param('linkId');

  const link = await c.env.DB.prepare(`
    SELECT 
      sl.id,
      sl.expires_at,
      sl.max_views,
      sl.view_count,
      sl.allow_copy,
      sl.revoked,
      sl.access_password_hash,
      s.name as secret_name,
      o.name as org_name
    FROM share_links sl
    JOIN secrets s ON sl.secret_id = s.id
    JOIN organizations o ON sl.org_id = o.id
    WHERE sl.id = ?
  `)
    .bind(linkId)
    .first<{
      id: string;
      expires_at: string;
      max_views: number;
      view_count: number;
      allow_copy: number;
      revoked: number;
      access_password_hash: string | null;
      secret_name: string;
      org_name: string;
    }>();

  if (!link) {
    return c.json({ error: 'Share link not found' }, 404);
  }

  // Check if valid
  const isExpired = new Date(link.expires_at) < new Date();
  const isExhausted = link.max_views > 0 && link.view_count >= link.max_views;
  const isRevoked = link.revoked === 1;

  if (isRevoked) {
    return c.json({ error: 'This share link has been revoked' }, 410);
  }

  if (isExpired) {
    return c.json({ error: 'This share link has expired' }, 410);
  }

  if (isExhausted) {
    return c.json({ error: 'This share link has reached its view limit' }, 410);
  }

  return c.json({
    secretName: link.secret_name,
    orgName: link.org_name,
    requiresPassword: !!link.access_password_hash,
    allowCopy: link.allow_copy === 1,
    expiresAt: link.expires_at,
    remainingViews: link.max_views > 0 ? link.max_views - link.view_count : null,
  });
});

// Access shared secret (public, no auth required)
sharingRoutes.post('/public/:linkId/access', async (c) => {
  const linkId = c.req.param('linkId');

  const link = await c.env.DB.prepare(`
    SELECT 
      sl.*,
      s.name as secret_name,
      s.ciphertext_blob,
      s.iv,
      s.secret_type,
      s.url,
      o.id as org_id
    FROM share_links sl
    JOIN secrets s ON sl.secret_id = s.id
    JOIN organizations o ON sl.org_id = o.id
    WHERE sl.id = ?
  `)
    .bind(linkId)
    .first<{
      id: string;
      secret_id: string;
      org_id: string;
      expires_at: string;
      max_views: number;
      view_count: number;
      allow_copy: number;
      revoked: number;
      access_password_hash: string | null;
      secret_name: string;
      ciphertext_blob: string;
      iv: string;
      secret_type: string;
      url: string | null;
    }>();

  if (!link) {
    return c.json({ error: 'Share link not found' }, 404);
  }

  // Validate link status
  if (link.revoked === 1) {
    return c.json({ error: 'This share link has been revoked' }, 410);
  }

  if (new Date(link.expires_at) < new Date()) {
    return c.json({ error: 'This share link has expired' }, 410);
  }

  if (link.max_views > 0 && link.view_count >= link.max_views) {
    return c.json({ error: 'This share link has reached its view limit' }, 410);
  }

  // Verify password if required
  if (link.access_password_hash) {
    const body = await c.req.json().catch(() => ({}));
    const password = body.password;

    if (!password) {
      return c.json({ error: 'Password required', requiresPassword: true }, 401);
    }

    const isValid = await verifySharePassword(password, link.access_password_hash);
    if (!isValid) {
      return c.json({ error: 'Invalid password' }, 401);
    }
  }

  // Increment view count
  await c.env.DB.prepare(`
    UPDATE share_links 
    SET view_count = view_count + 1, last_viewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
    .bind(linkId)
    .run();

  // Log access (anonymously in audit)
  await c.env.DB.prepare(`
    INSERT INTO audit_logs (org_id, action, target_type, target_id, target_name, metadata, ip_address, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `)
    .bind(
      link.org_id,
      'ACCESS_SHARE_LINK',
      'secret',
      link.secret_id,
      link.secret_name,
      JSON.stringify({ shareId: linkId }),
      c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
    )
    .run();

  // Return the encrypted secret
  // NOTE: The recipient will need the share-specific decryption key
  // which should be included in the share URL as a fragment
  return c.json({
    name: link.secret_name,
    url: link.url,
    secretType: link.secret_type,
    ciphertextBlob: link.ciphertext_blob,
    iv: link.iv,
    allowCopy: link.allow_copy === 1,
  });
});
