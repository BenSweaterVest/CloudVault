/**
 * Emergency Access Routes
 * 
 * Allows setting up trusted contacts who can request emergency access
 * to the organization's vault if the admin is unavailable.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../index';
import { authMiddleware } from '../middleware/auth';
import { createAuditLogger } from '../middleware/audit';
import { checkOrgAccess } from '../lib/db-utils';
import { z } from 'zod';
import { validateBody } from '../lib/validation';

export const emergencyRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const addEmergencyContactSchema = z.object({
  contactEmail: z.string().email(),
  contactName: z.string().min(1).max(100).optional(),
  waitTimeHours: z.number().int().min(24).max(720), // 1 day to 30 days
});

const requestEmergencyAccessSchema = z.object({
  reason: z.string().min(10).max(500),
});

// ============================================
// MANAGE EMERGENCY CONTACTS (Admin only)
// ============================================

// List emergency contacts
emergencyRoutes.get(
  '/:orgId/emergency-contacts',
  authMiddleware,
  async (c) => {
    const user = c.get('user')!;
    const orgId = c.req.param('orgId');

    // Check admin access
    const membership = await checkOrgAccess(c.env.DB, user.id, orgId, 'admin');

    if (!membership) {
      return c.json({ error: 'Admin access required' }, 403);
    }

    const results = await c.env.DB.prepare(`
      SELECT 
        ec.*,
        u.email as user_email,
        u.name as user_name
      FROM emergency_contacts ec
      JOIN users u ON ec.user_id = u.id
      WHERE ec.org_id = ? AND ec.status = 'active'
      ORDER BY ec.created_at DESC
    `)
      .bind(orgId)
      .all<{
        id: string;
        user_id: string;
        contact_email: string;
        contact_name: string | null;
        wait_time_hours: number;
        created_at: string;
        user_email: string;
        user_name: string | null;
      }>();

    return c.json(
      results.results.map((contact) => ({
        id: contact.id,
        userId: contact.user_id,
        userEmail: contact.user_email,
        userName: contact.user_name,
        contactEmail: contact.contact_email,
        contactName: contact.contact_name,
        waitTimeHours: contact.wait_time_hours,
        createdAt: contact.created_at,
      }))
    );
  }
);

// Add emergency contact for current user
emergencyRoutes.post(
  '/:orgId/emergency-contacts',
  authMiddleware,
  async (c) => {
    const user = c.get('user')!;
    const orgId = c.req.param('orgId');
    const audit = createAuditLogger(c);

    // Check membership (any active member can set up emergency contact)
    const membership = await checkOrgAccess(c.env.DB, user.id, orgId);

    if (!membership) {
      return c.json({ error: 'Not a member of this organization' }, 403);
    }

    // Check org settings
    const orgSettings = await c.env.DB.prepare(
      'SELECT allow_emergency_access, emergency_wait_min_hours FROM organization_settings WHERE org_id = ?'
    )
      .bind(orgId)
      .first<{ allow_emergency_access: number; emergency_wait_min_hours: number }>();

    if (orgSettings && !orgSettings.allow_emergency_access) {
      return c.json({ error: 'Emergency access is disabled for this organization' }, 403);
    }

    const data = await validateBody(c, addEmergencyContactSchema);

    // Enforce minimum wait time
    const minWait = orgSettings?.emergency_wait_min_hours || 24;
    if (data.waitTimeHours < minWait) {
      return c.json({ error: `Wait time must be at least ${minWait} hours` }, 400);
    }

    // Check if contact already exists for this user
    const existing = await c.env.DB.prepare(
      'SELECT id FROM emergency_contacts WHERE user_id = ? AND org_id = ? AND contact_email = ? AND status = ?'
    )
      .bind(user.id, orgId, data.contactEmail, 'active')
      .first();

    if (existing) {
      return c.json({ error: 'This emergency contact already exists' }, 409);
    }

    const contactId = crypto.randomUUID();

    await c.env.DB.prepare(`
      INSERT INTO emergency_contacts (id, org_id, user_id, contact_email, contact_name, wait_time_hours)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(contactId, orgId, user.id, data.contactEmail, data.contactName || null, data.waitTimeHours)
      .run();

    audit.log('ADD_EMERGENCY_CONTACT', {
      orgId,
      targetType: 'emergency_contact',
      targetId: contactId,
      targetName: data.contactEmail,
      metadata: { waitTimeHours: data.waitTimeHours },
    });

    return c.json({
      id: contactId,
      contactEmail: data.contactEmail,
      contactName: data.contactName,
      waitTimeHours: data.waitTimeHours,
    });
  }
);

// Remove emergency contact
emergencyRoutes.delete(
  '/:orgId/emergency-contacts/:contactId',
  authMiddleware,
  async (c) => {
    const user = c.get('user')!;
    const orgId = c.req.param('orgId');
    const contactId = c.req.param('contactId');
    const audit = createAuditLogger(c);

    // Check membership
    const membership = await checkOrgAccess(c.env.DB, user.id, orgId);

    if (!membership) {
      return c.json({ error: 'Not a member of this organization' }, 403);
    }

    // Get contact (must be own contact or admin)
    const contact = await c.env.DB.prepare(
      'SELECT * FROM emergency_contacts WHERE id = ? AND org_id = ?'
    )
      .bind(contactId, orgId)
      .first<{ id: string; user_id: string; contact_email: string }>();

    if (!contact) {
      return c.json({ error: 'Emergency contact not found' }, 404);
    }

    if (contact.user_id !== user.id && membership.role !== 'admin') {
      return c.json({ error: 'Can only remove your own emergency contacts' }, 403);
    }

    await c.env.DB.prepare(
      'UPDATE emergency_contacts SET status = ? WHERE id = ?'
    )
      .bind('revoked', contactId)
      .run();

    audit.log('REMOVE_EMERGENCY_CONTACT', {
      orgId,
      targetType: 'emergency_contact',
      targetId: contactId,
      targetName: contact.contact_email,
    });

    return c.json({ success: true });
  }
);

// ============================================
// EMERGENCY ACCESS REQUESTS
// ============================================

// Get pending emergency requests (admin view)
emergencyRoutes.get(
  '/:orgId/emergency-requests',
  authMiddleware,
  async (c) => {
    const user = c.get('user')!;
    const orgId = c.req.param('orgId');

    // Check admin access
    const membership = await checkOrgAccess(c.env.DB, user.id, orgId, 'admin');

    if (!membership) {
      return c.json({ error: 'Admin access required' }, 403);
    }

    const results = await c.env.DB.prepare(`
      SELECT 
        er.*,
        ec.contact_email,
        ec.contact_name,
        ec.wait_time_hours,
        u.email as user_email,
        u.name as user_name
      FROM emergency_requests er
      JOIN emergency_contacts ec ON er.emergency_contact_id = ec.id
      JOIN users u ON ec.user_id = u.id
      WHERE er.org_id = ?
      ORDER BY er.requested_at DESC
    `)
      .bind(orgId)
      .all<{
        id: string;
        requested_at: string;
        grant_at: string;
        status: string;
        reason: string;
        contact_email: string;
        contact_name: string | null;
        wait_time_hours: number;
        user_email: string;
        user_name: string | null;
      }>();

    return c.json(
      results.results.map((req) => ({
        id: req.id,
        requestedAt: req.requested_at,
        grantAt: req.grant_at,
        status: req.status,
        reason: req.reason,
        contactEmail: req.contact_email,
        contactName: req.contact_name,
        waitTimeHours: req.wait_time_hours,
        userEmail: req.user_email,
        userName: req.user_name,
        canDeny: req.status === 'pending' && req.grant_at !== null && new Date(req.grant_at) > new Date(),
      }))
    );
  }
);

// Request emergency access (public route - for emergency contacts)
emergencyRoutes.post('/request/:contactId', async (c) => {
  const contactId = c.req.param('contactId');

  const contact = await c.env.DB.prepare(
    'SELECT * FROM emergency_contacts WHERE id = ? AND status = ?'
  )
    .bind(contactId, 'active')
    .first<{
      id: string;
      org_id: string;
      user_id: string;
      contact_email: string;
      wait_time_hours: number;
    }>();

  if (!contact) {
    return c.json({ error: 'Invalid emergency contact' }, 404);
  }

  // Check for existing pending request
  const existingRequest = await c.env.DB.prepare(
    'SELECT id FROM emergency_requests WHERE emergency_contact_id = ? AND status = ?'
  )
    .bind(contactId, 'pending')
    .first();

  if (existingRequest) {
    return c.json({ error: 'An emergency access request is already pending' }, 409);
  }

  const data = await validateBody(c, requestEmergencyAccessSchema);
  const requestId = crypto.randomUUID();
  const grantAt = new Date(Date.now() + contact.wait_time_hours * 60 * 60 * 1000).toISOString();

  await c.env.DB.prepare(`
    INSERT INTO emergency_requests (id, emergency_contact_id, org_id, grant_at, reason)
    VALUES (?, ?, ?, ?, ?)
  `)
    .bind(requestId, contactId, contact.org_id, grantAt, data.reason)
    .run();

  // Log the request
  await c.env.DB.prepare(`
    INSERT INTO audit_logs (org_id, action, target_type, target_id, target_name, metadata, ip_address, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `)
    .bind(
      contact.org_id,
      'EMERGENCY_ACCESS_REQUESTED',
      'emergency_request',
      requestId,
      contact.contact_email,
      JSON.stringify({ reason: data.reason, grantAt }),
      c.req.header('CF-Connecting-IP') || 'unknown'
    )
    .run();

  // Note: Email notifications to admins can be implemented using RESEND_API_KEY
  // when available. Admins should monitor the emergency requests in the dashboard.

  return c.json({
    id: requestId,
    grantAt,
    waitTimeHours: contact.wait_time_hours,
    message: `Emergency access will be granted at ${grantAt} unless denied by an administrator.`,
  });
});

// Deny emergency access request (admin only)
emergencyRoutes.post(
  '/:orgId/emergency-requests/:requestId/deny',
  authMiddleware,
  async (c) => {
    const user = c.get('user')!;
    const orgId = c.req.param('orgId');
    const requestId = c.req.param('requestId');
    const audit = createAuditLogger(c);

    // Check admin access
    const membership = await checkOrgAccess(c.env.DB, user.id, orgId, 'admin');

    if (!membership) {
      return c.json({ error: 'Admin access required' }, 403);
    }

    // Get request
    const request = await c.env.DB.prepare(`
      SELECT er.*, ec.contact_email
      FROM emergency_requests er
      JOIN emergency_contacts ec ON er.emergency_contact_id = ec.id
      WHERE er.id = ? AND er.org_id = ? AND er.status = ?
    `)
      .bind(requestId, orgId, 'pending')
      .first<{ id: string; grant_at: string; contact_email: string }>();

    if (!request) {
      return c.json({ error: 'Emergency request not found or already processed' }, 404);
    }

    // Can only deny before grant time
    if (new Date(request.grant_at) <= new Date()) {
      return c.json({ error: 'Cannot deny - access has already been granted' }, 400);
    }

    await c.env.DB.prepare(`
      UPDATE emergency_requests 
      SET status = ?, denied_by = ?, denied_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
      .bind('denied', user.id, requestId)
      .run();

    audit.log('EMERGENCY_ACCESS_DENIED', {
      orgId,
      targetType: 'emergency_request',
      targetId: requestId,
      targetName: request.contact_email,
    });

    // Note: Email notification to requester can be implemented using RESEND_API_KEY

    return c.json({ success: true });
  }
);
