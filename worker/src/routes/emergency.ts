/**
 * Emergency access ("break glass").
 *
 * An admin designates a trusted person who already has a CloudVault account.
 * The admin's browser encrypts the org key for that person's public key (after
 * the admin checks the key fingerprint) and the server stores it in escrow.
 * The server cannot read it.
 *
 * If the contact requests access, admins are notified and have the waiting
 * period to deny. Once it passes (or an admin approves early) the contact
 * claims access and receives a read-only membership with the escrowed key.
 *
 * Admin routes are mounted on the org router (/api/organizations); contact
 * routes on /api/emergency. Both require authentication.
 */

import { Hono } from 'hono';
import type { AppContext, AppEnv } from '../env';
import { requireMembership } from '../lib/access';
import { auditStatement, createAuditLogger } from '../middleware/audit';
import { getUser, HttpError, param } from '../lib/http';
import { emailButton, emailLayout, escapeHtml, sendEmail } from '../lib/email';
import { addEmergencyContactSchema, emailSchema, requestEmergencyAccessSchema, validateBody } from '../lib/validation';
import { getOrgSettings } from './settings';

export const emergencyAdminRoutes = new Hono<AppEnv>();
export const emergencyContactRoutes = new Hono<AppEnv>();

async function notifyAdmins(c: AppContext, orgId: string, subject: string, html: string) {
  const admins = await c.env.DB.prepare(
    `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = ? AND m.role = 'admin' AND m.status = 'active'`
  )
    .bind(orgId)
    .all<{ email: string }>();
  if (admins.results.length === 0) return;
  const send = sendEmail(c.env, { to: admins.results.map((a) => a.email), subject, html });
  try {
    c.executionCtx.waitUntil(send);
  } catch {
    // no execution context (tests)
  }
}

// ============================================
// ADMIN: CONTACTS
// ============================================

emergencyAdminRoutes.get('/:orgId/emergency-contacts', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');
  const results = await c.env.DB.prepare(
    `SELECT ec.id, ec.contact_email, ec.contact_name, ec.wait_time_hours, ec.created_at, ec.contact_user_id,
            u.email AS created_by_email
     FROM emergency_contacts ec LEFT JOIN users u ON u.id = ec.user_id
     WHERE ec.org_id = ? AND ec.status = 'active'
     ORDER BY ec.created_at DESC`
  )
    .bind(orgId)
    .all<{
      id: string;
      contact_email: string;
      contact_name: string | null;
      wait_time_hours: number;
      created_at: string;
      contact_user_id: string;
      created_by_email: string | null;
    }>();

  return c.json(
    results.results.map((r) => ({
      id: r.id,
      contactEmail: r.contact_email,
      contactName: r.contact_name,
      contactUserId: r.contact_user_id,
      waitTimeHours: r.wait_time_hours,
      createdByEmail: r.created_by_email,
      createdAt: r.created_at,
    }))
  );
});

/** Look up a prospective contact's public key so the admin can escrow the org key. */
emergencyAdminRoutes.get('/:orgId/emergency-contacts/lookup', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');
  const parsed = emailSchema.safeParse(c.req.query('email') ?? '');
  if (!parsed.success) throw new HttpError(400, 'A valid email is required');

  const user = await c.env.DB.prepare('SELECT id, email, name, public_key FROM users WHERE email = ?')
    .bind(parsed.data)
    .first<{ id: string; email: string; name: string | null; public_key: string | null }>();
  if (!user?.public_key) {
    throw new HttpError(404, 'No CloudVault user with a master password set up was found for that email. Ask them to sign in and set up first.');
  }
  return c.json({ userId: user.id, email: user.email, name: user.name, publicKey: user.public_key });
});

emergencyAdminRoutes.post('/:orgId/emergency-contacts', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');
  const admin = getUser(c);
  const settings = await getOrgSettings(c.env.DB, orgId);
  if (!settings.allow_emergency_access) throw new HttpError(403, 'Emergency access is disabled for this organization');

  const data = await validateBody(c, addEmergencyContactSchema);
  if (data.waitTimeHours < settings.emergency_wait_min_hours) {
    throw new HttpError(400, `Wait time must be at least ${settings.emergency_wait_min_hours} hours`);
  }

  const contact = await c.env.DB.prepare('SELECT id, public_key FROM users WHERE email = ?')
    .bind(data.contactEmail)
    .first<{ id: string; public_key: string | null }>();
  if (!contact?.public_key) throw new HttpError(404, 'That person needs a CloudVault account with a master password first');
  if (contact.id === admin.id) throw new HttpError(400, 'You cannot be your own emergency contact');

  const [member, existing, org] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ?').bind(contact.id, orgId),
    c.env.DB.prepare("SELECT 1 FROM emergency_contacts WHERE org_id = ? AND contact_user_id = ? AND status = 'active'").bind(orgId, contact.id),
    c.env.DB.prepare('SELECT key_version FROM organizations WHERE id = ?').bind(orgId),
  ]);
  if (member.results.length > 0) throw new HttpError(409, 'That person is already a member of this organization');
  if (existing.results.length > 0) throw new HttpError(409, 'That person is already an emergency contact');

  const keyVersion = (org.results[0] as { key_version: number } | undefined)?.key_version ?? 1;
  const contactId = crypto.randomUUID();
  const audit = createAuditLogger(c);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO emergency_contacts (id, org_id, user_id, contact_email, contact_name, wait_time_hours, contact_user_id, encrypted_org_key, key_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(contactId, orgId, admin.id, data.contactEmail, data.contactName ?? null, data.waitTimeHours, contact.id, data.encryptedOrgKey, keyVersion),
    auditStatement(
      c.env.DB,
      audit.entry('ADD_EMERGENCY_CONTACT', {
        orgId,
        targetType: 'emergency_contact',
        targetId: contactId,
        targetName: data.contactEmail,
        metadata: { waitTimeHours: data.waitTimeHours },
      })
    ),
  ]);

  await sendEmail(c.env, {
    to: data.contactEmail,
    subject: 'You are now an emergency contact on CloudVault',
    html: emailLayout(
      'You are an emergency contact',
      `<p>${escapeHtml(admin.name || admin.email)} added you as an emergency contact. If you ever need access, sign in and open Emergency Access. Admins will have ${data.waitTimeHours} hours to respond before access is granted.</p>
       ${emailButton('Open CloudVault', `${new URL(c.env.APP_URL).origin}/emergency`)}`
    ),
  });

  return c.json(
    { id: contactId, contactEmail: data.contactEmail, contactName: data.contactName ?? null, contactUserId: contact.id, waitTimeHours: data.waitTimeHours },
    201
  );
});

emergencyAdminRoutes.delete('/:orgId/emergency-contacts/:contactId', async (c) => {
  const orgId = param(c, 'orgId');
  const contactId = param(c, 'contactId');
  await requireMembership(c, orgId, 'admin');

  const contact = await c.env.DB.prepare("SELECT contact_email FROM emergency_contacts WHERE id = ? AND org_id = ? AND status = 'active'")
    .bind(contactId, orgId)
    .first<{ contact_email: string }>();
  if (!contact) throw new HttpError(404, 'Emergency contact not found');

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE emergency_contacts SET status = 'revoked', encrypted_org_key = NULL WHERE id = ?").bind(contactId),
    c.env.DB.prepare(
      "UPDATE emergency_requests SET status = 'denied', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE emergency_contact_id = ? AND status IN ('pending', 'approved')"
    ).bind(getUser(c).id, contactId),
  ]);

  createAuditLogger(c).log('REMOVE_EMERGENCY_CONTACT', { orgId, targetType: 'emergency_contact', targetId: contactId, targetName: contact.contact_email });
  return c.json({ success: true });
});

// ============================================
// ADMIN: REQUESTS
// ============================================

emergencyAdminRoutes.get('/:orgId/emergency-requests', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');

  const results = await c.env.DB.prepare(
    `SELECT er.id, er.requested_at, er.grant_at, er.status, er.reason, er.resolved_at,
            ec.contact_email, ec.contact_name, ec.wait_time_hours, u.email AS resolved_by_email
     FROM emergency_requests er
     JOIN emergency_contacts ec ON er.emergency_contact_id = ec.id
     LEFT JOIN users u ON u.id = er.resolved_by
     WHERE er.org_id = ?
     ORDER BY er.requested_at DESC LIMIT 100`
  )
    .bind(orgId)
    .all<{
      id: string;
      requested_at: string;
      grant_at: string;
      status: string;
      reason: string | null;
      resolved_at: string | null;
      contact_email: string;
      contact_name: string | null;
      wait_time_hours: number;
      resolved_by_email: string | null;
    }>();

  return c.json(
    results.results.map((r) => ({
      id: r.id,
      requestedAt: r.requested_at,
      grantAt: r.grant_at,
      status: r.status,
      reason: r.reason,
      contactEmail: r.contact_email,
      contactName: r.contact_name,
      waitTimeHours: r.wait_time_hours,
      resolvedAt: r.resolved_at,
      resolvedByEmail: r.resolved_by_email,
      canRespond: r.status === 'pending' || r.status === 'approved',
    }))
  );
});

async function resolveRequest(c: AppContext, decision: 'approved' | 'denied') {
  const orgId = param(c, 'orgId');
  const requestId = param(c, 'requestId');
  await requireMembership(c, orgId, 'admin');

  const request = await c.env.DB.prepare(
    `SELECT er.id, er.status, ec.contact_email FROM emergency_requests er
     JOIN emergency_contacts ec ON ec.id = er.emergency_contact_id
     WHERE er.id = ? AND er.org_id = ?`
  )
    .bind(requestId, orgId)
    .first<{ id: string; status: string; contact_email: string }>();
  if (!request) throw new HttpError(404, 'Emergency request not found');

  const allowedFrom = decision === 'approved' ? ['pending'] : ['pending', 'approved'];
  if (!allowedFrom.includes(request.status)) throw new HttpError(409, `This request is already ${request.status}`);

  const grantAt = decision === 'approved' ? ', grant_at = CURRENT_TIMESTAMP' : '';
  await c.env.DB.prepare(
    `UPDATE emergency_requests SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP, denied_by = ?, denied_at = ?${grantAt}
     WHERE id = ?`
  )
    .bind(
      decision,
      getUser(c).id,
      decision === 'denied' ? getUser(c).id : null,
      decision === 'denied' ? new Date().toISOString() : null,
      requestId
    )
    .run();

  createAuditLogger(c).log(decision === 'approved' ? 'EMERGENCY_ACCESS_APPROVED' : 'EMERGENCY_ACCESS_DENIED', {
    orgId,
    targetType: 'emergency_request',
    targetId: requestId,
    targetName: request.contact_email,
  });

  await sendEmail(c.env, {
    to: request.contact_email,
    subject: `Your CloudVault emergency access request was ${decision}`,
    html: emailLayout(
      `Emergency access ${decision}`,
      decision === 'approved'
        ? `<p>An administrator approved your request. Sign in and open Emergency Access to claim it.</p>${emailButton('Open CloudVault', `${new URL(c.env.APP_URL).origin}/emergency`)}`
        : '<p>An administrator denied your request.</p>'
    ),
  });

  return c.json({ success: true, status: decision });
}

emergencyAdminRoutes.post('/:orgId/emergency-requests/:requestId/approve', (c) => resolveRequest(c, 'approved'));
emergencyAdminRoutes.post('/:orgId/emergency-requests/:requestId/deny', (c) => resolveRequest(c, 'denied'));

// ============================================
// CONTACT: /api/emergency
// ============================================

/** Orgs where the current user is an emergency contact, with request state. */
emergencyContactRoutes.get('/access', async (c) => {
  const user = getUser(c);
  const results = await c.env.DB.prepare(
    `SELECT ec.id, ec.org_id, ec.wait_time_hours, o.name AS org_name,
            er.id AS request_id, er.status AS request_status, er.requested_at, er.grant_at
     FROM emergency_contacts ec
     JOIN organizations o ON o.id = ec.org_id
     LEFT JOIN emergency_requests er ON er.id = (
       SELECT id FROM emergency_requests WHERE emergency_contact_id = ec.id ORDER BY requested_at DESC LIMIT 1
     )
     WHERE ec.contact_user_id = ? AND ec.status = 'active'
     ORDER BY o.name`
  )
    .bind(user.id)
    .all<{
      id: string;
      org_id: string;
      wait_time_hours: number;
      org_name: string;
      request_id: string | null;
      request_status: string | null;
      requested_at: string | null;
      grant_at: string | null;
    }>();

  return c.json(
    results.results.map((r) => ({
      contactId: r.id,
      orgId: r.org_id,
      orgName: r.org_name,
      waitTimeHours: r.wait_time_hours,
      request: r.request_id
        ? { id: r.request_id, status: r.request_status, requestedAt: r.requested_at, grantAt: r.grant_at }
        : null,
    }))
  );
});

emergencyContactRoutes.post('/access/:contactId/request', async (c) => {
  const contactId = param(c, 'contactId');
  const user = getUser(c);
  const { reason } = await validateBody(c, requestEmergencyAccessSchema);

  const contact = await c.env.DB.prepare(
    "SELECT id, org_id, wait_time_hours, contact_email FROM emergency_contacts WHERE id = ? AND contact_user_id = ? AND status = 'active'"
  )
    .bind(contactId, user.id)
    .first<{ id: string; org_id: string; wait_time_hours: number; contact_email: string }>();
  if (!contact) throw new HttpError(404, 'Emergency contact not found');

  const settings = await getOrgSettings(c.env.DB, contact.org_id);
  if (!settings.allow_emergency_access) throw new HttpError(403, 'Emergency access is disabled for this organization');

  const open = await c.env.DB.prepare("SELECT 1 FROM emergency_requests WHERE emergency_contact_id = ? AND status IN ('pending', 'approved')")
    .bind(contactId)
    .first();
  if (open) throw new HttpError(409, 'You already have an open request');

  const requestId = crypto.randomUUID();
  const grantAt = new Date(Date.now() + contact.wait_time_hours * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
  const audit = createAuditLogger(c);

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO emergency_requests (id, emergency_contact_id, org_id, grant_at, reason, requested_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(requestId, contactId, contact.org_id, grantAt, reason, user.id),
    auditStatement(
      c.env.DB,
      audit.entry('EMERGENCY_ACCESS_REQUESTED', {
        orgId: contact.org_id,
        targetType: 'emergency_request',
        targetId: requestId,
        targetName: contact.contact_email,
        metadata: { reason, grantAt },
      })
    ),
  ]);

  await notifyAdmins(
    c,
    contact.org_id,
    'Emergency access requested on CloudVault',
    emailLayout(
      'Emergency access requested',
      `<p><strong>${escapeHtml(contact.contact_email)}</strong> requested emergency access.</p>
       <p>Reason: ${escapeHtml(reason)}</p>
       <p>Access will be granted automatically after ${contact.wait_time_hours} hours (${escapeHtml(grantAt)} UTC) unless an admin denies it.</p>
       ${emailButton('Review request', `${new URL(c.env.APP_URL).origin}/settings`)}`
    )
  );

  return c.json({ id: requestId, grantAt, waitTimeHours: contact.wait_time_hours, status: 'pending' }, 201);
});

/**
 * Claim access once the waiting period has passed (or an admin approved).
 * Creates a read-only membership using the escrowed org key.
 */
emergencyContactRoutes.post('/access/requests/:requestId/claim', async (c) => {
  const requestId = param(c, 'requestId');
  const user = getUser(c);
  const db = c.env.DB;

  const request = await db
    .prepare(
      `SELECT er.id, er.status, er.grant_at, er.org_id, ec.encrypted_org_key, ec.key_version, ec.contact_email,
              o.key_version AS org_key_version
       FROM emergency_requests er
       JOIN emergency_contacts ec ON ec.id = er.emergency_contact_id
       JOIN organizations o ON o.id = er.org_id
       WHERE er.id = ? AND ec.contact_user_id = ? AND ec.status = 'active'`
    )
    .bind(requestId, user.id)
    .first<{
      id: string;
      status: string;
      grant_at: string;
      org_id: string;
      encrypted_org_key: string | null;
      key_version: number;
      contact_email: string;
      org_key_version: number;
    }>();

  if (!request) throw new HttpError(404, 'Emergency request not found');
  if (request.status !== 'pending' && request.status !== 'approved') throw new HttpError(409, `This request is ${request.status}`);

  const grantAt = new Date(`${request.grant_at.replace(' ', 'T')}${request.grant_at.endsWith('Z') ? '' : 'Z'}`);
  if (request.status === 'pending' && grantAt.getTime() > Date.now()) {
    throw new HttpError(403, 'The waiting period has not passed yet', 'WAITING_PERIOD', { grantAt: request.grant_at });
  }
  if (!request.encrypted_org_key || request.key_version !== request.org_key_version) {
    throw new HttpError(409, 'The escrowed key is out of date. Ask an admin to re-add you as an emergency contact.');
  }

  const audit = createAuditLogger(c);
  await db.batch([
    db
      .prepare(
        `INSERT INTO memberships (user_id, org_id, role, encrypted_org_key, status) VALUES (?, ?, 'read_only', ?, 'active')
         ON CONFLICT(user_id, org_id) DO UPDATE SET status = 'active', encrypted_org_key = excluded.encrypted_org_key`
      )
      .bind(user.id, request.org_id, request.encrypted_org_key),
    db
      .prepare("UPDATE emergency_requests SET status = 'granted', resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE id = ?")
      .bind(requestId),
    auditStatement(
      db,
      audit.entry('EMERGENCY_ACCESS_GRANTED', {
        orgId: request.org_id,
        targetType: 'emergency_request',
        targetId: requestId,
        targetName: request.contact_email,
      })
    ),
  ]);

  await notifyAdmins(
    c,
    request.org_id,
    'Emergency access granted on CloudVault',
    emailLayout('Emergency access granted', `<p>${escapeHtml(request.contact_email)} now has read-only access through emergency access.</p>`)
  );

  return c.json({ success: true, orgId: request.org_id, role: 'read_only' });
});
