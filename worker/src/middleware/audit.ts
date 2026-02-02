/**
 * Audit Logging Middleware
 * 
 * Logs all actions to the audit_logs table for governance compliance.
 * Uses waitUntil() for non-blocking writes.
 */

import { Context, Next } from 'hono';
import type { Env, Variables } from '../index';

/**
 * All possible audit actions tracked in the system
 */
export type AuditAction =
  // Authentication
  | 'LOGIN'
  | 'LOGOUT'
  | 'SETUP_KEYS'
  // Secrets
  | 'VIEW_SECRET'
  | 'CREATE_SECRET'
  | 'UPDATE_SECRET'
  | 'DELETE_SECRET'
  | 'VIEW_SECRET_HISTORY'
  | 'TOGGLE_FAVORITE'
  | 'IMPORT_SECRETS'
  | 'EXPORT_SECRETS'
  // Organizations
  | 'CREATE_ORG'
  | 'UPDATE_ORG'
  | 'DELETE_ORG'
  | 'UPDATE_ORG_SETTINGS'
  // Users
  | 'INVITE_USER'
  | 'APPROVE_USER'
  | 'REMOVE_USER'
  | 'UPDATE_USER_ROLE'
  | 'UPDATE_PROFILE'
  // Categories
  | 'CREATE_CATEGORY'
  | 'UPDATE_CATEGORY'
  | 'DELETE_CATEGORY'
  // Sharing
  | 'CREATE_SHARE_LINK'
  | 'REVOKE_SHARE_LINK'
  | 'ACCESS_SHARE_LINK'
  // Emergency Access
  | 'ADD_EMERGENCY_CONTACT'
  | 'REMOVE_EMERGENCY_CONTACT'
  | 'EMERGENCY_ACCESS_REQUESTED'
  | 'EMERGENCY_ACCESS_DENIED'
  | 'EMERGENCY_ACCESS_GRANTED'
  // Audit
  | 'VIEW_AUDIT_LOG'
  | 'EXPORT_AUDIT_LOG';

/**
 * Types of entities that can be targets of audit actions
 */
export type TargetType = 
  | 'secret' 
  | 'user' 
  | 'org'
  | 'organization' 
  | 'membership' 
  | 'category'
  | 'share_link'
  | 'emergency_contact'
  | 'emergency_request';

interface AuditLogEntry {
  orgId?: string;
  userId: string;
  userEmail: string;
  action: AuditAction;
  targetType?: TargetType;
  targetId?: string;
  targetName?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log an audit event to the database
 */
export async function logAuditEvent(
  db: D1Database,
  entry: AuditLogEntry
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_logs (
          org_id, user_id, user_email, action, target_type, target_id, target_name, metadata, ip_address, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        entry.orgId || null,
        entry.userId,
        entry.userEmail,
        entry.action,
        entry.targetType || null,
        entry.targetId || null,
        entry.targetName || null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.ipAddress || null,
        entry.userAgent || null
      )
      .run();
  } catch (err) {
    console.error('Failed to log audit event:', err);
    // Don't throw - audit logging should not break the main request
  }
}

/**
 * Create an audit logger for a specific request context
 */
export function createAuditLogger(
  c: Context<{ Bindings: Env; Variables: Variables }>
) {
  const user = c.get('user');
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For');
  const userAgent = c.req.header('User-Agent');
  
  return {
    /**
     * Log an event in the background (non-blocking)
     */
    log(
      action: AuditAction,
      options?: {
        orgId?: string;
        targetType?: TargetType;
        targetId?: string;
        targetName?: string;
        metadata?: Record<string, unknown>;
      }
    ): void {
      if (!user) return;
      
      c.executionCtx.waitUntil(
        logAuditEvent(c.env.DB, {
          orgId: options?.orgId,
          userId: user.id,
          userEmail: user.email,
          action,
          targetType: options?.targetType,
          targetId: options?.targetId,
          targetName: options?.targetName,
          metadata: options?.metadata,
          ipAddress: ipAddress || undefined,
          userAgent: userAgent || undefined,
        })
      );
    },
    
    /**
     * Log an event synchronously (blocking)
     */
    async logSync(
      action: AuditAction,
      options?: {
        orgId?: string;
        targetType?: TargetType;
        targetId?: string;
        targetName?: string;
        metadata?: Record<string, unknown>;
      }
    ): Promise<void> {
      if (!user) return;
      
      await logAuditEvent(c.env.DB, {
        orgId: options?.orgId,
        userId: user.id,
        userEmail: user.email,
        action,
        targetType: options?.targetType,
        targetId: options?.targetId,
        targetName: options?.targetName,
        metadata: options?.metadata,
        ipAddress: ipAddress || undefined,
        userAgent: userAgent || undefined,
      });
    },
  };
}

/**
 * Automatic audit middleware that logs based on route patterns
 */
export function auditMiddleware(
  _c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
) {
  // The actual logging is done in individual route handlers using createAuditLogger
  // This middleware could be extended to do automatic logging based on HTTP methods
  return next();
}
