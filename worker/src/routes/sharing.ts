/**
 * Share links: temporary, view-limited access to one secret for someone
 * outside the vault.
 *
 * Zero-knowledge design:
 *   1. The sharer's browser decrypts the secret, generates a random 256-bit
 *      share key, and re-encrypts the secret with it (bound to the link id).
 *   2. Only that share ciphertext is uploaded. The share key goes in the URL
 *      fragment (#...), which browsers never send to the server.
 *   3. Optional password: the browser derives an access token from the
 *      password with PBKDF2 and uploads only SHA-256(token). The recipient's
 *      browser derives the same token; the server compares hashes. No slow
 *      hashing runs on the server, which keeps it inside the free plan's
 *      10 ms CPU budget.
 *
 * Authenticated routes are mounted on the org router (/api/organizations);
 * public routes on /api/share.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireMembership } from '../lib/access';
import { createAuditLogger, logAuditEvent } from '../middleware/audit';
import { getClientIp, HttpError, param } from '../lib/http';
import { sha256Hex, timingSafeEqual } from '../lib/crypto';
import { accessShareLinkSchema, createShareLinkSchema, validateBody } from '../lib/validation';
import { getOrgSettings } from './settings';

export const sharingRoutes = new Hono<AppEnv>();
export const publicShareRoutes = new Hono<AppEnv>();

function shareUrlBase(appUrl: string, linkId: string): string {
  // The key fragment is appended by the client; the server never has it.
  return `${new URL(appUrl).origin}/share/${linkId}`;
}

// ============================================
// AUTHENTICATED (org router)
// ============================================

sharingRoutes.post('/:orgId/secrets/:secretId/shares', async (c) => {
  const orgId = param(c, 'orgId');
  const secretId = param(c, 'secretId');
  await requireMembership(c, orgId, 'member');
  const user = c.get('user');

  const settings = await getOrgSettings(c.env.DB, orgId);
  if (!settings.allow_share_links) throw new HttpError(403, 'Share links are disabled for this organization');

  const secret = await c.env.DB.prepare('SELECT name FROM secrets WHERE id = ? AND org_id = ?')
    .bind(secretId, orgId)
    .first<{ name: string }>();
  if (!secret) throw new HttpError(404, 'Secret not found');

  const data = await validateBody(c, createShareLinkSchema);
  if (data.expiresInHours > settings.share_link_max_hours) {
    throw new HttpError(400, `Share links cannot last longer than ${settings.share_link_max_hours} hours in this organization`);
  }

  const expiresAt = new Date(Date.now() + data.expiresInHours * 3_600_000).toISOString();
  try {
    await c.env.DB.prepare(
      `INSERT INTO share_links (id, secret_id, org_id, created_by, expires_at, max_views, allow_copy, recipient_email,
                                ciphertext_blob, iv, access_salt, access_verifier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        data.id,
        secretId,
        orgId,
        user?.id ?? null,
        expiresAt,
        data.maxViews,
        data.allowCopy ? 1 : 0,
        data.recipientEmail ?? null,
        data.ciphertextBlob,
        data.iv,
        data.accessSalt ?? null,
        data.accessVerifier ?? null
      )
      .run();
  } catch (err) {
    if (err instanceof Error && /UNIQUE|PRIMARY KEY/i.test(err.message)) throw new HttpError(409, 'Share link id already exists');
    throw err;
  }

  createAuditLogger(c).log('CREATE_SHARE_LINK', {
    orgId,
    targetType: 'secret',
    targetId: secretId,
    targetName: secret.name,
    metadata: { shareId: data.id, expiresAt, maxViews: data.maxViews, hasPassword: !!data.accessVerifier, recipientEmail: data.recipientEmail },
  });

  return c.json(
    {
      id: data.id,
      url: shareUrlBase(c.env.APP_URL, data.id),
      expiresAt,
      maxViews: data.maxViews,
      viewCount: 0,
      hasPassword: !!data.accessVerifier,
      allowCopy: data.allowCopy,
      recipientEmail: data.recipientEmail ?? null,
      isRevoked: false,
    },
    201
  );
});

sharingRoutes.get('/:orgId/secrets/:secretId/shares', async (c) => {
  const orgId = param(c, 'orgId');
  const secretId = param(c, 'secretId');
  await requireMembership(c, orgId);

  const results = await c.env.DB.prepare(
    `SELECT sl.id, sl.expires_at, sl.max_views, sl.view_count, sl.allow_copy, sl.recipient_email, sl.revoked,
            sl.created_at, sl.last_viewed_at, sl.access_verifier, u.email AS created_by_email
     FROM share_links sl LEFT JOIN users u ON sl.created_by = u.id
     WHERE sl.secret_id = ? AND sl.org_id = ?
     ORDER BY sl.created_at DESC`
  )
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
      access_verifier: string | null;
      created_by_email: string | null;
    }>();

  const now = Date.now();
  return c.json(
    results.results.map((link) => ({
      id: link.id,
      url: shareUrlBase(c.env.APP_URL, link.id),
      expiresAt: link.expires_at,
      maxViews: link.max_views,
      viewCount: link.view_count,
      allowCopy: link.allow_copy === 1,
      recipientEmail: link.recipient_email,
      isRevoked: link.revoked === 1,
      isExpired: new Date(link.expires_at).getTime() < now,
      isExhausted: link.max_views > 0 && link.view_count >= link.max_views,
      hasPassword: !!link.access_verifier,
      createdAt: link.created_at,
      lastViewedAt: link.last_viewed_at,
      createdByEmail: link.created_by_email,
    }))
  );
});

sharingRoutes.delete('/:orgId/shares/:linkId', async (c) => {
  const orgId = param(c, 'orgId');
  const linkId = param(c, 'linkId');
  await requireMembership(c, orgId, 'member');

  const link = await c.env.DB.prepare(
    `SELECT sl.secret_id, s.name AS secret_name FROM share_links sl JOIN secrets s ON sl.secret_id = s.id
     WHERE sl.id = ? AND sl.org_id = ?`
  )
    .bind(linkId, orgId)
    .first<{ secret_id: string; secret_name: string }>();
  if (!link) throw new HttpError(404, 'Share link not found');

  // Drop the ciphertext too: a revoked link should hold nothing useful.
  await c.env.DB.prepare('UPDATE share_links SET revoked = 1, ciphertext_blob = NULL, iv = NULL WHERE id = ?').bind(linkId).run();

  createAuditLogger(c).log('REVOKE_SHARE_LINK', {
    orgId,
    targetType: 'secret',
    targetId: link.secret_id,
    targetName: link.secret_name,
    metadata: { shareId: linkId },
  });
  return c.json({ success: true });
});

// ============================================
// PUBLIC (/api/share)
// ============================================

interface PublicLinkRow {
  id: string;
  secret_id: string;
  org_id: string;
  expires_at: string;
  max_views: number;
  view_count: number;
  allow_copy: number;
  revoked: number;
  access_salt: string | null;
  access_verifier: string | null;
  secret_name: string;
  secret_type: string;
  url: string | null;
  org_name: string;
}

async function loadPublicLink(db: D1Database, linkId: string): Promise<PublicLinkRow> {
  const link = await db
    .prepare(
      `SELECT sl.id, sl.secret_id, sl.org_id, sl.expires_at, sl.max_views, sl.view_count, sl.allow_copy, sl.revoked,
              sl.access_salt, sl.access_verifier,
              s.name AS secret_name, s.secret_type, s.url, o.name AS org_name
       FROM share_links sl
       JOIN secrets s ON sl.secret_id = s.id
       JOIN organizations o ON sl.org_id = o.id
       WHERE sl.id = ?`
    )
    .bind(linkId)
    .first<PublicLinkRow>();

  if (!link) throw new HttpError(404, 'Share link not found');
  if (link.revoked) throw new HttpError(410, 'This share link has been revoked');
  if (new Date(link.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'This share link has expired');
  if (link.max_views > 0 && link.view_count >= link.max_views) throw new HttpError(410, 'This share link has reached its view limit');
  return link;
}

/** Link status, without consuming a view. */
publicShareRoutes.get('/:linkId', async (c) => {
  const link = await loadPublicLink(c.env.DB, param(c, 'linkId'));
  return c.json({
    secretName: link.secret_name,
    orgName: link.org_name,
    requiresPassword: !!link.access_verifier,
    accessSalt: link.access_salt,
    allowCopy: link.allow_copy === 1,
    expiresAt: link.expires_at,
    remainingViews: link.max_views > 0 ? link.max_views - link.view_count : null,
  });
});

/** Consume one view and return the share ciphertext. */
publicShareRoutes.post('/:linkId/access', async (c) => {
  const linkId = param(c, 'linkId');
  const link = await loadPublicLink(c.env.DB, linkId);
  const { accessToken } = await validateBody(c, accessShareLinkSchema);

  if (link.access_verifier) {
    if (!accessToken) throw new HttpError(401, 'Password required', 'PASSWORD_REQUIRED');
    if (!timingSafeEqual(await sha256Hex(accessToken), link.access_verifier)) {
      throw new HttpError(401, 'Incorrect password', 'PASSWORD_INCORRECT');
    }
  }

  // Atomic: the view is only counted (and the payload only returned) if the
  // link is still valid at the moment of the update.
  const consumed = await c.env.DB.prepare(
    `UPDATE share_links SET view_count = view_count + 1, last_viewed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND revoked = 0 AND expires_at > ? AND (max_views = 0 OR view_count < max_views)
     RETURNING ciphertext_blob, iv, allow_copy, view_count, max_views`
  )
    .bind(linkId, new Date().toISOString())
    .first<{ ciphertext_blob: string | null; iv: string | null; allow_copy: number; view_count: number; max_views: number }>();

  if (!consumed || !consumed.ciphertext_blob || !consumed.iv) {
    throw new HttpError(410, 'This share link is no longer available');
  }

  await logAuditEvent(c.env.DB, {
    orgId: link.org_id,
    action: 'ACCESS_SHARE_LINK',
    targetType: 'secret',
    targetId: link.secret_id,
    targetName: link.secret_name,
    metadata: { shareId: linkId, viewNumber: consumed.view_count },
    ipAddress: getClientIp(c),
    userAgent: c.req.header('User-Agent'),
  });

  return c.json({
    name: link.secret_name,
    url: link.url,
    secretType: link.secret_type,
    ciphertextBlob: consumed.ciphertext_blob,
    iv: consumed.iv,
    allowCopy: consumed.allow_copy === 1,
    remainingViews: consumed.max_views > 0 ? consumed.max_views - consumed.view_count : null,
  });
});
