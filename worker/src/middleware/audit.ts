/**
 * Audit logging.
 *
 * Writes go through executionCtx.waitUntil() so they do not add latency to
 * the response. AUDIT_ACTIONS is the single list of valid actions; the audit
 * log query schema is derived from it so the two can never drift apart.
 */

import type { AppContext } from '../env';
import { getClientIp } from '../lib/http';

export const AUDIT_ACTIONS = [
  // Authentication
  'LOGIN',
  'LOGOUT',
  'LOGOUT_ALL',
  'SETUP_KEYS',
  'CHANGE_MASTER_PASSWORD',
  'UPDATE_PROFILE',
  // Secrets
  'VIEW_SECRET',
  'CREATE_SECRET',
  'UPDATE_SECRET',
  'DELETE_SECRET',
  'VIEW_SECRET_HISTORY',
  'IMPORT_SECRETS',
  'EXPORT_SECRETS',
  // Organizations
  'CREATE_ORG',
  'UPDATE_ORG',
  'DELETE_ORG',
  'UPDATE_ORG_SETTINGS',
  'ROTATE_ORG_KEY',
  // Members
  'INVITE_USER',
  'APPROVE_USER',
  'REMOVE_USER',
  'LEAVE_ORG',
  'UPDATE_USER_ROLE',
  // Categories
  'CREATE_CATEGORY',
  'UPDATE_CATEGORY',
  'DELETE_CATEGORY',
  // Sharing
  'CREATE_SHARE_LINK',
  'REVOKE_SHARE_LINK',
  'ACCESS_SHARE_LINK',
  // Emergency access
  'ADD_EMERGENCY_CONTACT',
  'REMOVE_EMERGENCY_CONTACT',
  'EMERGENCY_ACCESS_REQUESTED',
  'EMERGENCY_ACCESS_APPROVED',
  'EMERGENCY_ACCESS_DENIED',
  'EMERGENCY_ACCESS_GRANTED',
  // Audit
  'VIEW_AUDIT_LOG',
  'EXPORT_AUDIT_LOG',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type TargetType =
  | 'secret'
  | 'user'
  | 'organization'
  | 'membership'
  | 'category'
  | 'share_link'
  | 'emergency_contact'
  | 'emergency_request';

export interface AuditEntry {
  orgId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  action: AuditAction;
  targetType?: TargetType;
  targetId?: string;
  targetName?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Build the INSERT statement for an audit entry (usable in D1 batches). */
export function auditStatement(db: D1Database, entry: AuditEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs (org_id, user_id, user_email, action, target_type, target_id, target_name, metadata, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      entry.orgId ?? null,
      entry.userId ?? null,
      entry.userEmail ?? null,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.targetName ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.ipAddress ?? null,
      entry.userAgent?.slice(0, 300) ?? null
    );
}

/** Write an audit entry. Never throws. */
export async function logAuditEvent(db: D1Database, entry: AuditEntry): Promise<void> {
  try {
    await auditStatement(db, entry).run();
  } catch (err) {
    console.error('Failed to write audit log:', err instanceof Error ? err.message : 'unknown');
  }
}

/**
 * Audit logger bound to the current request. Fills in the acting user, IP
 * address and user agent, and writes in the background.
 */
export function createAuditLogger(c: AppContext) {
  const user = c.get('user');
  const base = {
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    ipAddress: getClientIp(c),
    userAgent: c.req.header('User-Agent') ?? null,
  };

  return {
    /** Full entry with request details, for use in a batch. */
    entry(action: AuditAction, options: Omit<AuditEntry, 'action'> = {}): AuditEntry {
      return { ...base, ...options, action };
    },
    /** Log in the background. */
    log(action: AuditAction, options: Omit<AuditEntry, 'action'> = {}): void {
      const write = logAuditEvent(c.env.DB, { ...base, ...options, action });
      try {
        c.executionCtx.waitUntil(write);
      } catch {
        // No execution context (for example in some test setups): the
        // promise still runs, we just cannot extend the request lifetime.
      }
    },
  };
}
