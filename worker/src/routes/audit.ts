/**
 * Audit Log Routes
 *
 * Provides access to audit logs for governance and compliance.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../index';
import { authMiddleware } from '../middleware/auth';
import { createAuditLogger } from '../middleware/audit';

/**
 * Safely parse JSON with fallback to null
 */
function safeParseJson(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    // Data corruption - return null rather than crash
    return null;
  }
}

export const auditRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// All routes require authentication
auditRoutes.use('*', authMiddleware);

/**
 * List audit logs for an organization
 */
auditRoutes.get('/:orgId/audit', async (c) => {
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
  
  // Parse query params
  const url = new URL(c.req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const action = url.searchParams.get('action');
  const userId = url.searchParams.get('userId');
  
  // Build query
  let query = 'SELECT * FROM audit_logs WHERE org_id = ?';
  const params: (string | number)[] = [orgId];
  
  if (action) {
    query += ' AND action = ?';
    params.push(action);
  }
  
  if (userId) {
    query += ' AND user_id = ?';
    params.push(userId);
  }
  
  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  const results = await c.env.DB.prepare(query)
    .bind(...params)
    .all<{
      id: number;
      org_id: string;
      user_id: string;
      user_email: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      target_name: string | null;
      metadata: string | null;
      ip_address: string | null;
      timestamp: string;
    }>();
  
  // Get total count
  let countQuery = 'SELECT COUNT(*) as count FROM audit_logs WHERE org_id = ?';
  const countParams: (string | number)[] = [orgId];
  
  if (action) {
    countQuery += ' AND action = ?';
    countParams.push(action);
  }
  
  if (userId) {
    countQuery += ' AND user_id = ?';
    countParams.push(userId);
  }
  
  const countResult = await c.env.DB.prepare(countQuery)
    .bind(...countParams)
    .first<{ count: number }>();
  
  // Log that audit was viewed
  audit.log('VIEW_AUDIT_LOG', {
    orgId,
    metadata: { filters: { action, userId }, limit, offset },
  });
  
  return c.json({
    logs: results.results.map((log) => ({
      id: log.id,
      orgId: log.org_id,
      userId: log.user_id,
      userEmail: log.user_email,
      action: log.action,
      targetType: log.target_type,
      targetId: log.target_id,
      targetName: log.target_name,
      metadata: safeParseJson(log.metadata),
      ipAddress: log.ip_address,
      timestamp: log.timestamp,
    })),
    total: countResult?.count || 0,
  });
});

/**
 * Export audit logs as CSV
 */
auditRoutes.get('/:orgId/audit/export', async (c) => {
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
  
  // Get all audit logs for this org
  const results = await c.env.DB.prepare(`
    SELECT * FROM audit_logs WHERE org_id = ? ORDER BY timestamp DESC
  `)
    .bind(orgId)
    .all<{
      id: number;
      org_id: string;
      user_id: string;
      user_email: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      target_name: string | null;
      metadata: string | null;
      ip_address: string | null;
      timestamp: string;
    }>();
  
  // Build CSV
  const headers = [
    'ID',
    'Timestamp',
    'User Email',
    'Action',
    'Target Type',
    'Target Name',
    'IP Address',
    'Metadata',
  ];
  
  const rows = results.results.map((log) => [
    log.id.toString(),
    log.timestamp,
    log.user_email,
    log.action,
    log.target_type || '',
    log.target_name || '',
    log.ip_address || '',
    log.metadata || '',
  ]);
  
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n');
  
  // Log export
  audit.log('EXPORT_AUDIT_LOG', {
    orgId,
    metadata: { rowCount: results.results.length },
  });
  
  // Get org name for filename
  const org = await c.env.DB.prepare('SELECT name FROM organizations WHERE id = ?')
    .bind(orgId)
    .first<{ name: string }>();
  
  const filename = `${org?.name || 'audit'}-logs-${new Date().toISOString().split('T')[0]}.csv`;
  
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

/**
 * Get audit log statistics
 */
auditRoutes.get('/:orgId/audit/stats', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  
  // Check admin access
  const membership = await c.env.DB.prepare(
    'SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND status = ?'
  )
    .bind(user.id, orgId, 'active')
    .first<{ role: string }>();
  
  if (!membership || membership.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }
  
  // Get action counts
  const actionCounts = await c.env.DB.prepare(`
    SELECT action, COUNT(*) as count
    FROM audit_logs
    WHERE org_id = ?
    GROUP BY action
    ORDER BY count DESC
  `)
    .bind(orgId)
    .all<{ action: string; count: number }>();
  
  // Get user activity counts
  const userCounts = await c.env.DB.prepare(`
    SELECT user_email, COUNT(*) as count
    FROM audit_logs
    WHERE org_id = ?
    GROUP BY user_email
    ORDER BY count DESC
    LIMIT 10
  `)
    .bind(orgId)
    .all<{ user_email: string; count: number }>();
  
  // Get recent activity count (last 7 days)
  const recentCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as count
    FROM audit_logs
    WHERE org_id = ? AND timestamp > datetime('now', '-7 days')
  `)
    .bind(orgId)
    .first<{ count: number }>();
  
  return c.json({
    actionCounts: actionCounts.results,
    topUsers: userCounts.results,
    last7Days: recentCount?.count || 0,
  });
});
