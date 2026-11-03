/**
 * Organization settings and the password health report.
 *
 * Mounted on the authenticated org router at /api/organizations.
 *
 * Enforcement of each setting:
 *   minPasswordLength     password generator minimum and form warning (client)
 *   passwordExpiryDays    default expiry for new passwords (client)
 *   allowShareLinks       share link creation (server)
 *   shareLinkMaxHours     share link lifetime cap (server)
 *   allowEmergencyAccess  contact creation and requests (server)
 *   emergencyWaitMinHours minimum wait for new contacts (server)
 *   auditRetentionDays    daily cleanup job deletes older audit rows (server)
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireMembership } from '../lib/access';
import { createAuditLogger } from '../middleware/audit';
import { param } from '../lib/http';
import { updateOrgSettingsSchema, validateBody } from '../lib/validation';

export const settingsRoutes = new Hono<AppEnv>();

export interface OrgSettingsRow {
  min_password_length: number;
  password_expiry_days: number;
  allow_share_links: number;
  share_link_max_hours: number;
  allow_emergency_access: number;
  emergency_wait_min_hours: number;
  audit_retention_days: number;
}

export const DEFAULT_ORG_SETTINGS: OrgSettingsRow = {
  min_password_length: 12,
  password_expiry_days: 90,
  allow_share_links: 1,
  share_link_max_hours: 168,
  allow_emergency_access: 1,
  emergency_wait_min_hours: 24,
  audit_retention_days: 365,
};

export async function getOrgSettings(db: D1Database, orgId: string): Promise<OrgSettingsRow> {
  const row = await db.prepare('SELECT * FROM organization_settings WHERE org_id = ?').bind(orgId).first<OrgSettingsRow>();
  return row ?? DEFAULT_ORG_SETTINGS;
}

function serialize(s: OrgSettingsRow) {
  return {
    minPasswordLength: s.min_password_length,
    passwordExpiryDays: s.password_expiry_days,
    allowShareLinks: s.allow_share_links === 1,
    shareLinkMaxHours: s.share_link_max_hours,
    allowEmergencyAccess: s.allow_emergency_access === 1,
    emergencyWaitMinHours: s.emergency_wait_min_hours,
    auditRetentionDays: s.audit_retention_days,
  };
}

settingsRoutes.get('/:orgId/settings', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId);
  return c.json(serialize(await getOrgSettings(c.env.DB, orgId)));
});

settingsRoutes.put('/:orgId/settings', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');
  const data = await validateBody(c, updateOrgSettingsSchema);
  const db = c.env.DB;

  const columns: Record<string, string> = {
    minPasswordLength: 'min_password_length',
    passwordExpiryDays: 'password_expiry_days',
    allowShareLinks: 'allow_share_links',
    shareLinkMaxHours: 'share_link_max_hours',
    allowEmergencyAccess: 'allow_emergency_access',
    emergencyWaitMinHours: 'emergency_wait_min_hours',
    auditRetentionDays: 'audit_retention_days',
  };

  const updates: string[] = [];
  const values: number[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    updates.push(`${columns[key]} = ?`);
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
  }

  const statements: D1PreparedStatement[] = [db.prepare('INSERT OR IGNORE INTO organization_settings (org_id) VALUES (?)').bind(orgId)];
  if (updates.length > 0) {
    statements.push(
      db
        .prepare(`UPDATE organization_settings SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE org_id = ?`)
        .bind(...values, orgId)
    );
  }
  await db.batch(statements);

  createAuditLogger(c).log('UPDATE_ORG_SETTINGS', { orgId, targetType: 'organization', targetId: orgId, metadata: data });
  return c.json(serialize(await getOrgSettings(db, orgId)));
});

/**
 * Password health based on metadata the server can see (expiry dates and
 * last change). Reuse and strength checks need plaintext and run client side.
 */
settingsRoutes.get('/:orgId/health', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId);
  const db = c.env.DB;

  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString();

  const [counts, expiring, stale] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN secret_type = 'password' THEN 1 ELSE 0 END) AS total,
           SUM(CASE WHEN expires_at IS NOT NULL AND expires_at > ?2 AND expires_at <= ?3 THEN 1 ELSE 0 END) AS expiring_soon,
           SUM(CASE WHEN expires_at IS NOT NULL AND expires_at <= ?2 THEN 1 ELSE 0 END) AS expired,
           SUM(CASE WHEN secret_type = 'password' AND updated_at <= datetime('now', '-90 days') THEN 1 ELSE 0 END) AS old_passwords
         FROM secrets WHERE org_id = ?1`
      )
      .bind(orgId, now, soon),
    db
      .prepare(
        `SELECT id, name, expires_at, secret_type FROM secrets
         WHERE org_id = ? AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at LIMIT 10`
      )
      .bind(orgId, soon),
    db
      .prepare(
        `SELECT id, name, updated_at FROM secrets
         WHERE org_id = ? AND secret_type = 'password' AND updated_at <= datetime('now', '-90 days')
         ORDER BY updated_at LIMIT 10`
      )
      .bind(orgId),
  ]);

  const row = (counts.results[0] ?? {}) as { total?: number; expiring_soon?: number; expired?: number; old_passwords?: number };
  const total = row.total ?? 0;
  const expiringSoon = row.expiring_soon ?? 0;
  const expired = row.expired ?? 0;
  const oldPasswords = row.old_passwords ?? 0;

  let healthScore = 100;
  if (total > 0) {
    const issues = expiringSoon + expired * 2 + oldPasswords;
    healthScore = Math.max(0, Math.round(100 - (issues / total) * 100));
  }

  const day = 86_400_000;
  return c.json({
    healthScore,
    totalSecrets: total,
    metrics: { expiringSoon, expired, oldPasswords },
    expiringSecrets: (expiring.results as Array<{ id: string; name: string; expires_at: string; secret_type: string }>).map((s) => ({
      id: s.id,
      name: s.name,
      expiresAt: s.expires_at,
      secretType: s.secret_type,
      daysUntilExpiry: Math.ceil((new Date(s.expires_at).getTime() - Date.now()) / day),
    })),
    oldPasswords: (stale.results as Array<{ id: string; name: string; updated_at: string }>).map((s) => ({
      id: s.id,
      name: s.name,
      lastUpdated: s.updated_at,
      daysSinceUpdate: Math.floor((Date.now() - new Date(`${s.updated_at.replace(' ', 'T')}Z`).getTime()) / day),
    })),
  });
});
