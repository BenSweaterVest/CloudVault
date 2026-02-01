/**
 * Organization Settings Routes
 * 
 * Manage organization-wide configuration and security policies.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../index';
import { authMiddleware } from '../middleware/auth';
import { createAuditLogger } from '../middleware/audit';
import { z } from 'zod';
import { validateBody } from '../lib/validation';

export const settingsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const updateOrgSettingsSchema = z.object({
  require2fa: z.boolean().optional(),
  minPasswordLength: z.number().int().min(8).max(64).optional(),
  passwordExpiryDays: z.number().int().min(0).max(365).optional(),
  allowShareLinks: z.boolean().optional(),
  shareLinkMaxHours: z.number().int().min(1).max(720).optional(), // Max 30 days
  allowEmergencyAccess: z.boolean().optional(),
  emergencyWaitMinHours: z.number().int().min(24).max(720).optional(),
  auditRetentionDays: z.number().int().min(30).max(730).optional(), // 30 days to 2 years
});

// ============================================
// ROUTES
// ============================================

// Get organization settings
settingsRoutes.get('/:orgId/settings', authMiddleware, async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');

  // Check membership
  const membership = await c.env.DB.prepare(
    'SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND status = ?'
  )
    .bind(user.id, orgId, 'active')
    .first<{ role: string }>();

  if (!membership) {
    return c.json({ error: 'Not a member of this organization' }, 403);
  }

  // Get or create default settings
  let settings = await c.env.DB.prepare(
    'SELECT * FROM organization_settings WHERE org_id = ?'
  )
    .bind(orgId)
    .first<{
      require_2fa: number;
      min_password_length: number;
      password_expiry_days: number;
      allow_share_links: number;
      share_link_max_hours: number;
      allow_emergency_access: number;
      emergency_wait_min_hours: number;
      audit_retention_days: number;
    }>();

  if (!settings) {
    // Create default settings
    await c.env.DB.prepare(`
      INSERT INTO organization_settings (org_id) VALUES (?)
    `)
      .bind(orgId)
      .run();

    settings = {
      require_2fa: 0,
      min_password_length: 12,
      password_expiry_days: 90,
      allow_share_links: 1,
      share_link_max_hours: 168,
      allow_emergency_access: 1,
      emergency_wait_min_hours: 24,
      audit_retention_days: 365,
    };
  }

  return c.json({
    require2fa: settings.require_2fa === 1,
    minPasswordLength: settings.min_password_length,
    passwordExpiryDays: settings.password_expiry_days,
    allowShareLinks: settings.allow_share_links === 1,
    shareLinkMaxHours: settings.share_link_max_hours,
    allowEmergencyAccess: settings.allow_emergency_access === 1,
    emergencyWaitMinHours: settings.emergency_wait_min_hours,
    auditRetentionDays: settings.audit_retention_days,
  });
});

// Update organization settings (admin only)
settingsRoutes.put('/:orgId/settings', authMiddleware, async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const audit = createAuditLogger(c);

  // Check admin access
  const membership = await c.env.DB.prepare(
    'SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND status = ?'
  )
    .bind(user.id, orgId, 'active')
    .first<{ role: string }>();

  if (!membership || membership.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const data = await validateBody(c, updateOrgSettingsSchema);

  // Ensure settings row exists
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO organization_settings (org_id) VALUES (?)
  `)
    .bind(orgId)
    .run();

  // Build update query
  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (data.require2fa !== undefined) {
    updates.push('require_2fa = ?');
    values.push(data.require2fa ? 1 : 0);
  }
  if (data.minPasswordLength !== undefined) {
    updates.push('min_password_length = ?');
    values.push(data.minPasswordLength);
  }
  if (data.passwordExpiryDays !== undefined) {
    updates.push('password_expiry_days = ?');
    values.push(data.passwordExpiryDays);
  }
  if (data.allowShareLinks !== undefined) {
    updates.push('allow_share_links = ?');
    values.push(data.allowShareLinks ? 1 : 0);
  }
  if (data.shareLinkMaxHours !== undefined) {
    updates.push('share_link_max_hours = ?');
    values.push(data.shareLinkMaxHours);
  }
  if (data.allowEmergencyAccess !== undefined) {
    updates.push('allow_emergency_access = ?');
    values.push(data.allowEmergencyAccess ? 1 : 0);
  }
  if (data.emergencyWaitMinHours !== undefined) {
    updates.push('emergency_wait_min_hours = ?');
    values.push(data.emergencyWaitMinHours);
  }
  if (data.auditRetentionDays !== undefined) {
    updates.push('audit_retention_days = ?');
    values.push(data.auditRetentionDays);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(orgId);

    await c.env.DB.prepare(
      `UPDATE organization_settings SET ${updates.join(', ')} WHERE org_id = ?`
    )
      .bind(...values)
      .run();
  }

  // Log settings change
  audit.log('UPDATE_ORG_SETTINGS', {
    orgId,
    targetType: 'organization',
    targetId: orgId,
    metadata: data,
  });

  // Return updated settings
  const settings = await c.env.DB.prepare(
    'SELECT * FROM organization_settings WHERE org_id = ?'
  )
    .bind(orgId)
    .first<{
      require_2fa: number;
      min_password_length: number;
      password_expiry_days: number;
      allow_share_links: number;
      share_link_max_hours: number;
      allow_emergency_access: number;
      emergency_wait_min_hours: number;
      audit_retention_days: number;
    }>();

  return c.json({
    require2fa: settings!.require_2fa === 1,
    minPasswordLength: settings!.min_password_length,
    passwordExpiryDays: settings!.password_expiry_days,
    allowShareLinks: settings!.allow_share_links === 1,
    shareLinkMaxHours: settings!.share_link_max_hours,
    allowEmergencyAccess: settings!.allow_emergency_access === 1,
    emergencyWaitMinHours: settings!.emergency_wait_min_hours,
    auditRetentionDays: settings!.audit_retention_days,
  });
});

// Get password health report
settingsRoutes.get('/:orgId/health', authMiddleware, async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');

  // Check membership
  const membership = await c.env.DB.prepare(
    'SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND status = ?'
  )
    .bind(user.id, orgId, 'active')
    .first<{ role: string }>();

  if (!membership) {
    return c.json({ error: 'Not a member of this organization' }, 403);
  }

  // Get counts for health metrics
  const totalSecrets = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM secrets WHERE org_id = ? AND secret_type = ?'
  )
    .bind(orgId, 'password')
    .first<{ count: number }>();

  // Expiring soon (within 30 days)
  const expiringSoon = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM secrets 
    WHERE org_id = ? 
    AND expires_at IS NOT NULL 
    AND expires_at <= datetime('now', '+30 days')
    AND expires_at > datetime('now')
  `)
    .bind(orgId)
    .first<{ count: number }>();

  // Already expired
  const expired = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM secrets 
    WHERE org_id = ? 
    AND expires_at IS NOT NULL 
    AND expires_at <= datetime('now')
  `)
    .bind(orgId)
    .first<{ count: number }>();

  // Old passwords (not updated in 90+ days)
  const oldPasswords = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM secrets 
    WHERE org_id = ? 
    AND secret_type = 'password'
    AND updated_at <= datetime('now', '-90 days')
  `)
    .bind(orgId)
    .first<{ count: number }>();

  // Get expiring secrets list
  const expiringSecrets = await c.env.DB.prepare(`
    SELECT id, name, expires_at, secret_type
    FROM secrets 
    WHERE org_id = ? 
    AND expires_at IS NOT NULL 
    AND expires_at <= datetime('now', '+30 days')
    ORDER BY expires_at ASC
    LIMIT 10
  `)
    .bind(orgId)
    .all<{ id: string; name: string; expires_at: string; secret_type: string }>();

  // Get old passwords list
  const oldPasswordsList = await c.env.DB.prepare(`
    SELECT id, name, updated_at
    FROM secrets 
    WHERE org_id = ? 
    AND secret_type = 'password'
    AND updated_at <= datetime('now', '-90 days')
    ORDER BY updated_at ASC
    LIMIT 10
  `)
    .bind(orgId)
    .all<{ id: string; name: string; updated_at: string }>();

  // Calculate health score (simple formula)
  const total = totalSecrets?.count || 0;
  let healthScore = 100;
  if (total > 0) {
    const issues = (expiringSoon?.count || 0) + (expired?.count || 0) * 2 + (oldPasswords?.count || 0);
    healthScore = Math.max(0, Math.round(100 - (issues / total) * 100));
  }

  return c.json({
    healthScore,
    totalSecrets: total,
    metrics: {
      expiringSoon: expiringSoon?.count || 0,
      expired: expired?.count || 0,
      oldPasswords: oldPasswords?.count || 0,
    },
    expiringSecrets: expiringSecrets.results.map((s) => ({
      id: s.id,
      name: s.name,
      expiresAt: s.expires_at,
      secretType: s.secret_type,
      daysUntilExpiry: Math.ceil(
        (new Date(s.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      ),
    })),
    oldPasswords: oldPasswordsList.results.map((s) => ({
      id: s.id,
      name: s.name,
      lastUpdated: s.updated_at,
      daysSinceUpdate: Math.floor(
        (Date.now() - new Date(s.updated_at).getTime()) / (1000 * 60 * 60 * 24)
      ),
    })),
  });
});
