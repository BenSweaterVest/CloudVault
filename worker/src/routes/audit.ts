/**
 * Audit log access (admins only).
 *
 * Mounted on the authenticated org router at /api/organizations.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireMembership } from '../lib/access';
import { createAuditLogger } from '../middleware/audit';
import { param } from '../lib/http';
import { auditLogQuerySchema, validateQuery } from '../lib/validation';

export const auditRoutes = new Hono<AppEnv>();

interface AuditRow {
  id: number;
  org_id: string | null;
  user_id: string | null;
  user_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  metadata: string | null;
  ip_address: string | null;
  user_agent: string | null;
  timestamp: string;
}

function parseJson(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** D1 stores CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" (UTC). */
function toSqlTimestamp(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Quote a CSV cell and neutralize spreadsheet formulas. Values that begin
 * with = + - @ (or tab/CR) are prefixed with a quote so Excel and Sheets
 * treat them as text. Secret names and emails are user controlled.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

auditRoutes.get('/:orgId/audit', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');
  const query = validateQuery(c, auditLogQuerySchema);

  let where = 'WHERE org_id = ?';
  const params: (string | number)[] = [orgId];
  if (query.action) (where += ' AND action = ?', params.push(query.action));
  if (query.userId) (where += ' AND user_id = ?', params.push(query.userId));
  if (query.startDate) (where += ' AND timestamp >= ?', params.push(toSqlTimestamp(query.startDate)));
  if (query.endDate) (where += ' AND timestamp <= ?', params.push(toSqlTimestamp(query.endDate)));

  const [rows, count] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(`SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`).bind(
      ...params,
      query.limit,
      query.offset
    ),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where}`).bind(...params),
  ]);

  createAuditLogger(c).log('VIEW_AUDIT_LOG', {
    orgId,
    metadata: { action: query.action, userId: query.userId, limit: query.limit, offset: query.offset },
  });

  return c.json({
    logs: (rows.results as unknown as AuditRow[]).map((log) => ({
      id: log.id,
      orgId: log.org_id,
      userId: log.user_id,
      userEmail: log.user_email,
      action: log.action,
      targetType: log.target_type,
      targetId: log.target_id,
      targetName: log.target_name,
      metadata: parseJson(log.metadata),
      ipAddress: log.ip_address,
      userAgent: log.user_agent,
      timestamp: log.timestamp,
    })),
    total: (count.results[0] as { count: number } | undefined)?.count ?? 0,
  });
});

auditRoutes.get('/:orgId/audit/export', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');

  const [rows, org] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare('SELECT * FROM audit_logs WHERE org_id = ? ORDER BY timestamp DESC, id DESC LIMIT 50000').bind(orgId),
    c.env.DB.prepare('SELECT name FROM organizations WHERE id = ?').bind(orgId),
  ]);
  const logs = rows.results as unknown as AuditRow[];

  const header = ['ID', 'Timestamp (UTC)', 'User Email', 'Action', 'Target Type', 'Target Name', 'IP Address', 'User Agent', 'Metadata'];
  const lines = logs.map((log) =>
    [log.id, log.timestamp, log.user_email, log.action, log.target_type, log.target_name, log.ip_address, log.user_agent, log.metadata]
      .map(csvCell)
      .join(',')
  );
  const csv = [header.map(csvCell).join(','), ...lines].join('\r\n');

  createAuditLogger(c).log('EXPORT_AUDIT_LOG', { orgId, metadata: { rowCount: logs.length } });

  const orgName = (org.results[0] as { name: string } | undefined)?.name ?? 'audit';
  const safeName = orgName.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'audit';
  const filename = `${safeName}-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

auditRoutes.get('/:orgId/audit/stats', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');
  const db = c.env.DB;

  const [actions, users, recent] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT action, COUNT(*) AS count FROM audit_logs WHERE org_id = ? GROUP BY action ORDER BY count DESC').bind(orgId),
    db
      .prepare(
        'SELECT user_email, COUNT(*) AS count FROM audit_logs WHERE org_id = ? AND user_email IS NOT NULL GROUP BY user_email ORDER BY count DESC LIMIT 10'
      )
      .bind(orgId),
    db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE org_id = ? AND timestamp > datetime('now', '-7 days')").bind(orgId),
  ]);

  return c.json({
    actionCounts: actions.results,
    topUsers: users.results,
    last7Days: (recent.results[0] as { count: number } | undefined)?.count ?? 0,
  });
});
