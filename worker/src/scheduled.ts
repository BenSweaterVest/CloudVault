/**
 * Daily maintenance (Cron Trigger, included in the Workers free plan).
 *
 * Keeps D1 small and enforces time-based policies:
 *   - deletes expired sessions, rate limit counters and magic links
 *   - clears ciphertext from expired or exhausted share links
 *   - expires emergency requests whose contact was removed
 *   - deletes audit logs older than each org's retention setting
 */

import type { Env } from './env';

export async function runMaintenance(env: Env, now = new Date()): Promise<Record<string, number>> {
  const db = env.DB;
  const epoch = Math.floor(now.getTime() / 1000);
  const iso = now.toISOString();

  const results = await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR (revoked = 1 AND last_activity_at <= ?)').bind(epoch, epoch - 86_400),
    db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(epoch),
    db.prepare('DELETE FROM magic_links WHERE expires_at <= ? OR used = 1').bind(iso),
    db
      .prepare(
        `UPDATE share_links SET ciphertext_blob = NULL, iv = NULL
         WHERE ciphertext_blob IS NOT NULL AND (expires_at <= ? OR revoked = 1 OR (max_views > 0 AND view_count >= max_views))`
      )
      .bind(iso),
    db.prepare(
      `UPDATE emergency_requests SET status = 'expired'
       WHERE status IN ('pending', 'approved')
         AND emergency_contact_id IN (SELECT id FROM emergency_contacts WHERE status != 'active')`
    ),
    db.prepare(
      `DELETE FROM audit_logs WHERE id IN (
         SELECT a.id FROM audit_logs a
         JOIN organization_settings s ON s.org_id = a.org_id
         WHERE a.timestamp < datetime('now', '-' || s.audit_retention_days || ' days')
       )`
    ),
  ]);

  const [sessions, rateLimits, magicLinks, shareLinks, emergency, audit] = results.map((r) => r.meta?.changes ?? 0);
  return { sessions, rateLimits, magicLinks, shareLinks, emergency, audit };
}
