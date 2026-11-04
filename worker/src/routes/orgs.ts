/**
 * Organizations, memberships and org key rotation.
 *
 * Mounted on the authenticated org router at /api/organizations.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { countActiveAdmins, requireMembership, type Role } from '../lib/access';
import { auditStatement, createAuditLogger } from '../middleware/audit';
import { getUser, HttpError, param } from '../lib/http';
import { chunkJson } from '../lib/db';
import { emailButton, emailLayout, escapeHtml, sendEmail } from '../lib/email';
import {
  approveUserSchema,
  createOrgSchema,
  inviteUserSchema,
  rotateOrgKeySchema,
  updateOrgSchema,
  updateRoleSchema,
  validateBody,
} from '../lib/validation';

export const orgsRoutes = new Hono<AppEnv>();

interface MemberRow {
  user_id: string;
  org_id: string;
  role: Role;
  encrypted_org_key: string | null;
  status: 'pending' | 'active';
  created_at: string;
  user_email: string;
  user_name: string | null;
  user_public_key: string | null;
}

function serializeMember(m: MemberRow) {
  return {
    userId: m.user_id,
    orgId: m.org_id,
    role: m.role,
    status: m.status,
    userEmail: m.user_email,
    userName: m.user_name,
    userPublicKey: m.user_public_key,
    hasKeys: !!m.user_public_key,
    createdAt: m.created_at,
  };
}

async function getMember(db: D1Database, orgId: string, userId: string): Promise<MemberRow | null> {
  return db
    .prepare(
      `SELECT m.user_id, m.org_id, m.role, m.encrypted_org_key, m.status, m.created_at,
              u.email AS user_email, u.name AS user_name, u.public_key AS user_public_key
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = ? AND m.user_id = ?`
    )
    .bind(orgId, userId)
    .first<MemberRow>();
}

/** Statements that clean up a user's per-org state when they leave an org. */
function departureStatements(db: D1Database, orgId: string, userId: string): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM memberships WHERE user_id = ? AND org_id = ?').bind(userId, orgId),
    db
      .prepare('DELETE FROM secret_favorites WHERE user_id = ? AND secret_id IN (SELECT id FROM secrets WHERE org_id = ?)')
      .bind(userId, orgId),
    db
      .prepare("UPDATE emergency_contacts SET status = 'revoked' WHERE org_id = ? AND (user_id = ? OR contact_user_id = ?)")
      .bind(orgId, userId, userId),
  ];
}

// ============================================
// ORGANIZATIONS
// ============================================

orgsRoutes.get('/', async (c) => {
  const user = getUser(c);
  const results = await c.env.DB.prepare(
    `SELECT o.id, o.name, o.created_at, o.key_version, m.role, m.encrypted_org_key
     FROM organizations o
     JOIN memberships m ON o.id = m.org_id
     WHERE m.user_id = ? AND m.status = 'active'
     ORDER BY o.name`
  )
    .bind(user.id)
    .all<{ id: string; name: string; created_at: string; key_version: number; role: Role; encrypted_org_key: string }>();

  // Pending invites are listed separately so the user knows to wait for approval.
  const pending = await c.env.DB.prepare(
    `SELECT o.id, o.name FROM organizations o
     JOIN memberships m ON o.id = m.org_id
     WHERE m.user_id = ? AND m.status = 'pending'
     ORDER BY o.name`
  )
    .bind(user.id)
    .all<{ id: string; name: string }>();

  return c.json({
    organizations: results.results.map((o) => ({
      id: o.id,
      name: o.name,
      role: o.role,
      encryptedOrgKey: o.encrypted_org_key,
      keyVersion: o.key_version,
      createdAt: o.created_at,
    })),
    pendingInvites: pending.results,
  });
});

orgsRoutes.post('/', async (c) => {
  const user = getUser(c);
  const { name, encryptedOrgKey } = await validateBody(c, createOrgSchema);
  const audit = createAuditLogger(c);
  const orgId = crypto.randomUUID();

  const keys = await c.env.DB.prepare('SELECT public_key FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ public_key: string | null }>();
  if (!keys?.public_key) throw new HttpError(400, 'Set up your master password before creating an organization');

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)').bind(orgId, name),
    c.env.DB.prepare(
      "INSERT INTO memberships (user_id, org_id, role, encrypted_org_key, status) VALUES (?, ?, 'admin', ?, 'active')"
    ).bind(user.id, orgId, encryptedOrgKey),
    c.env.DB.prepare('INSERT INTO organization_settings (org_id) VALUES (?)').bind(orgId),
    auditStatement(
      c.env.DB,
      audit.entry('CREATE_ORG', { orgId, targetType: 'organization', targetId: orgId, targetName: name })
    ),
  ]);

  return c.json(
    { id: orgId, name, role: 'admin', encryptedOrgKey, keyVersion: 1, createdAt: new Date().toISOString() },
    201
  );
});

orgsRoutes.get('/:orgId', async (c) => {
  const orgId = param(c, 'orgId');
  const membership = await requireMembership(c, orgId);
  const org = await c.env.DB.prepare('SELECT id, name, key_version, created_at FROM organizations WHERE id = ?')
    .bind(orgId)
    .first<{ id: string; name: string; key_version: number; created_at: string }>();
  if (!org) throw new HttpError(404, 'Organization not found');
  return c.json({ id: org.id, name: org.name, role: membership.role, keyVersion: org.key_version, createdAt: org.created_at });
});

orgsRoutes.patch('/:orgId', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');
  const { name } = await validateBody(c, updateOrgSchema);
  await c.env.DB.prepare('UPDATE organizations SET name = ? WHERE id = ?').bind(name, orgId).run();
  createAuditLogger(c).log('UPDATE_ORG', { orgId, targetType: 'organization', targetId: orgId, targetName: name });
  return c.json({ success: true, name });
});

/**
 * Delete an organization and everything in it, atomically.
 * Audit log rows are kept (their org_id is cleared by the foreign key).
 */
orgsRoutes.delete('/:orgId', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');
  const audit = createAuditLogger(c);
  const db = c.env.DB;

  const org = await db
    .prepare(
      `SELECT o.name,
        (SELECT COUNT(*) FROM memberships WHERE org_id = o.id AND status = 'active') AS member_count,
        (SELECT COUNT(*) FROM secrets WHERE org_id = o.id) AS secret_count
       FROM organizations o WHERE o.id = ?`
    )
    .bind(orgId)
    .first<{ name: string; member_count: number; secret_count: number }>();
  if (!org) throw new HttpError(404, 'Organization not found');

  await db.batch([
    // Written first, with org_id NULL so it survives the delete.
    auditStatement(
      db,
      audit.entry('DELETE_ORG', {
        targetType: 'organization',
        targetId: orgId,
        targetName: org.name,
        metadata: { memberCount: org.member_count, secretCount: org.secret_count },
      })
    ),
    db.prepare('DELETE FROM share_links WHERE org_id = ?').bind(orgId),
    db.prepare('DELETE FROM emergency_requests WHERE org_id = ?').bind(orgId),
    db.prepare('DELETE FROM emergency_contacts WHERE org_id = ?').bind(orgId),
    db.prepare('DELETE FROM organization_settings WHERE org_id = ?').bind(orgId),
    db.prepare('DELETE FROM secret_favorites WHERE secret_id IN (SELECT id FROM secrets WHERE org_id = ?)').bind(orgId),
    db.prepare('DELETE FROM secret_history WHERE secret_id IN (SELECT id FROM secrets WHERE org_id = ?)').bind(orgId),
    db.prepare('DELETE FROM secrets WHERE org_id = ?').bind(orgId),
    db.prepare('DELETE FROM categories WHERE org_id = ?').bind(orgId),
    db.prepare('DELETE FROM memberships WHERE org_id = ?').bind(orgId),
    db.prepare('UPDATE audit_logs SET org_id = NULL WHERE org_id = ?').bind(orgId),
    db.prepare('DELETE FROM organizations WHERE id = ?').bind(orgId),
  ]);

  return c.json({
    success: true,
    message: `Organization "${org.name}" has been deleted`,
    deleted: { members: org.member_count, secrets: org.secret_count },
  });
});

// ============================================
// MEMBERS
// ============================================

/** Members list. Admins see everyone; other members see active members only. */
orgsRoutes.get('/:orgId/members', async (c) => {
  const orgId = param(c, 'orgId');
  const membership = await requireMembership(c, orgId);
  const isAdmin = membership.role === 'admin';

  const results = await c.env.DB.prepare(
    `SELECT m.user_id, m.org_id, m.role, m.encrypted_org_key, m.status, m.created_at,
            u.email AS user_email, u.name AS user_name, u.public_key AS user_public_key
     FROM memberships m JOIN users u ON m.user_id = u.id
     WHERE m.org_id = ? ${isAdmin ? '' : "AND m.status = 'active'"}
     ORDER BY m.status DESC, m.created_at`
  )
    .bind(orgId)
    .all<MemberRow>();

  return c.json(results.results.map(serializeMember));
});

orgsRoutes.post('/:orgId/members', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');
  const inviter = getUser(c);
  const { email, role } = await validateBody(c, inviteUserSchema);
  const audit = createAuditLogger(c);
  const db = c.env.DB;

  let invited = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!invited) {
    const userId = crypto.randomUUID();
    await db.prepare("INSERT INTO users (id, email, auth_provider) VALUES (?, ?, 'magic_link')").bind(userId, email).run();
    invited = { id: userId };
  }

  const existing = await db
    .prepare('SELECT status FROM memberships WHERE user_id = ? AND org_id = ?')
    .bind(invited.id, orgId)
    .first<{ status: string }>();
  if (existing) throw new HttpError(409, 'User is already a member or has a pending invite');

  await db
    .prepare("INSERT INTO memberships (user_id, org_id, role, status, invited_by) VALUES (?, ?, ?, 'pending', ?)")
    .bind(invited.id, orgId, role, inviter.id)
    .run();

  audit.log('INVITE_USER', { orgId, targetType: 'user', targetId: invited.id, targetName: email, metadata: { role } });

  const org = await db.prepare('SELECT name FROM organizations WHERE id = ?').bind(orgId).first<{ name: string }>();
  const emailed = await sendEmail(c.env, {
    to: email,
    subject: `You have been invited to ${org?.name ?? 'a vault'} on CloudVault`,
    html: emailLayout(
      'You have been invited to CloudVault',
      `<p>${escapeHtml(inviter.name || inviter.email)} invited you to the <strong>${escapeHtml(org?.name ?? '')}</strong> vault.</p>
       <p>Sign in and set up your master password. An admin then approves your access from their browser, which is how your copy of the vault key is created.</p>
       ${emailButton('Open CloudVault', new URL(c.env.APP_URL).origin + '/login')}`
    ),
  });

  const member = await getMember(db, orgId, invited.id);
  if (!member) throw new HttpError(500, 'Failed to load membership');
  return c.json({ ...serializeMember(member), invitationEmailed: emailed }, 201);
});

/**
 * Approve a pending member. The admin's browser has encrypted the org key for
 * the member's public key (after the admin verified the key fingerprint).
 */
orgsRoutes.post('/:orgId/members/:userId/approve', async (c) => {
  const orgId = param(c, 'orgId');
  const userId = param(c, 'userId');
  await requireMembership(c, orgId, 'admin');
  const { encryptedOrgKey } = await validateBody(c, approveUserSchema);
  const db = c.env.DB;

  const pending = await getMember(db, orgId, userId);
  if (!pending || pending.status !== 'pending') throw new HttpError(404, 'No pending membership found');
  if (!pending.user_public_key) {
    throw new HttpError(409, 'This user has not set up their master password yet');
  }

  await db
    .prepare("UPDATE memberships SET status = 'active', encrypted_org_key = ? WHERE user_id = ? AND org_id = ? AND status = 'pending'")
    .bind(encryptedOrgKey, userId, orgId)
    .run();

  createAuditLogger(c).log('APPROVE_USER', {
    orgId,
    targetType: 'user',
    targetId: userId,
    targetName: pending.user_email,
    metadata: { role: pending.role },
  });

  const member = await getMember(db, orgId, userId);
  if (!member) throw new HttpError(500, 'Failed to load membership');
  return c.json(serializeMember(member));
});

orgsRoutes.patch('/:orgId/members/:userId', async (c) => {
  const orgId = param(c, 'orgId');
  const userId = param(c, 'userId');
  await requireMembership(c, orgId, 'admin');
  const { role } = await validateBody(c, updateRoleSchema);

  if (userId === getUser(c).id) throw new HttpError(400, "You can't change your own role");

  const target = await getMember(c.env.DB, orgId, userId);
  if (!target) throw new HttpError(404, 'Member not found');

  if (target.role === 'admin' && role !== 'admin' && target.status === 'active') {
    if ((await countActiveAdmins(c.env.DB, orgId)) <= 1) {
      throw new HttpError(400, 'An organization must keep at least one admin');
    }
  }

  await c.env.DB.prepare('UPDATE memberships SET role = ? WHERE user_id = ? AND org_id = ?').bind(role, userId, orgId).run();

  createAuditLogger(c).log('UPDATE_USER_ROLE', {
    orgId,
    targetType: 'membership',
    targetId: userId,
    targetName: target.user_email,
    metadata: { oldRole: target.role, newRole: role },
  });
  return c.json({ success: true, role });
});

/**
 * Remove a member. Their copy of the org key is deleted, but anything they
 * already decrypted (and the org key itself, if they kept it) cannot be
 * recalled: the response recommends rotating the org key.
 */
orgsRoutes.delete('/:orgId/members/:userId', async (c) => {
  const orgId = param(c, 'orgId');
  const userId = param(c, 'userId');
  await requireMembership(c, orgId, 'admin');
  if (userId === getUser(c).id) throw new HttpError(400, 'Use "Leave organization" to remove yourself');

  const target = await getMember(c.env.DB, orgId, userId);
  if (!target) throw new HttpError(404, 'Member not found');

  const audit = createAuditLogger(c);
  await c.env.DB.batch([
    ...departureStatements(c.env.DB, orgId, userId),
    auditStatement(
      c.env.DB,
      audit.entry('REMOVE_USER', { orgId, targetType: 'user', targetId: userId, targetName: target.user_email })
    ),
  ]);

  return c.json({ success: true, recommendKeyRotation: target.status === 'active' });
});

/** Leave an organization. The last admin must hand over or delete the org first. */
orgsRoutes.post('/:orgId/leave', async (c) => {
  const orgId = param(c, 'orgId');
  const membership = await requireMembership(c, orgId);
  const user = getUser(c);

  if (membership.role === 'admin' && (await countActiveAdmins(c.env.DB, orgId)) <= 1) {
    throw new HttpError(400, 'You are the only admin. Promote another member first, or delete the organization.');
  }

  const audit = createAuditLogger(c);
  await c.env.DB.batch([
    ...departureStatements(c.env.DB, orgId, user.id),
    auditStatement(c.env.DB, audit.entry('LEAVE_ORG', { orgId, targetType: 'user', targetId: user.id, targetName: user.email })),
  ]);
  return c.json({ success: true });
});

// ============================================
// KEY ROTATION
// ============================================

/**
 * Everything an admin's browser needs to rotate the org key: all ciphertext
 * (current and history), and the public keys it must re-encrypt the new key for.
 */
orgsRoutes.get('/:orgId/key-rotation', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');
  const db = c.env.DB;

  const [org, secrets, history, members, contacts] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT key_version FROM organizations WHERE id = ?').bind(orgId),
    db.prepare('SELECT id, ciphertext_blob, iv, enc_version FROM secrets WHERE org_id = ?').bind(orgId),
    db
      .prepare(
        `SELECT h.id, h.secret_id, h.ciphertext_blob, h.iv, h.enc_version
         FROM secret_history h JOIN secrets s ON s.id = h.secret_id WHERE s.org_id = ?`
      )
      .bind(orgId),
    db
      .prepare(
        `SELECT m.user_id, u.email, u.public_key FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.org_id = ? AND m.status = 'active'`
      )
      .bind(orgId),
    db
      .prepare(
        `SELECT ec.id, ec.contact_email, u.public_key FROM emergency_contacts ec
         JOIN users u ON u.id = ec.contact_user_id
         WHERE ec.org_id = ? AND ec.status = 'active'`
      )
      .bind(orgId),
  ]);

  const keyVersion = (org.results[0] as { key_version: number } | undefined)?.key_version;
  if (keyVersion === undefined) throw new HttpError(404, 'Organization not found');

  return c.json({
    keyVersion,
    secrets: (secrets.results as Array<{ id: string; ciphertext_blob: string; iv: string; enc_version: number }>).map((s) => ({
      id: s.id,
      ciphertextBlob: s.ciphertext_blob,
      iv: s.iv,
      encVersion: s.enc_version,
    })),
    history: (history.results as Array<{ id: number; secret_id: string; ciphertext_blob: string; iv: string; enc_version: number }>).map(
      (h) => ({ id: h.id, secretId: h.secret_id, ciphertextBlob: h.ciphertext_blob, iv: h.iv, encVersion: h.enc_version })
    ),
    members: (members.results as Array<{ user_id: string; email: string; public_key: string }>).map((m) => ({
      userId: m.user_id,
      email: m.email,
      publicKey: m.public_key,
    })),
    emergencyContacts: (contacts.results as Array<{ id: string; contact_email: string; public_key: string }>).map((e) => ({
      contactId: e.id,
      email: e.contact_email,
      publicKey: e.public_key,
    })),
  });
});

/**
 * Commit a rotation atomically. The submission must cover exactly the
 * current set of secrets, history entries, active members and active
 * emergency contacts, and start from the current key version; otherwise the
 * vault changed during rotation and the client must retry (409).
 */
orgsRoutes.post('/:orgId/key-rotation', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'admin');
  const data = await validateBody(c, rotateOrgKeySchema);
  const db = c.env.DB;

  const [org, secretIds, historyIds, memberIds, contactIds] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT key_version FROM organizations WHERE id = ?').bind(orgId),
    db.prepare('SELECT id FROM secrets WHERE org_id = ?').bind(orgId),
    db.prepare('SELECT h.id FROM secret_history h JOIN secrets s ON s.id = h.secret_id WHERE s.org_id = ?').bind(orgId),
    db.prepare("SELECT user_id AS id FROM memberships WHERE org_id = ? AND status = 'active'").bind(orgId),
    db.prepare("SELECT id FROM emergency_contacts WHERE org_id = ? AND status = 'active'").bind(orgId),
  ]);

  const currentVersion = (org.results[0] as { key_version: number } | undefined)?.key_version;
  if (currentVersion === undefined) throw new HttpError(404, 'Organization not found');

  const sameSet = (rows: unknown[], submitted: Array<string | number>) => {
    const expected = new Set((rows as Array<{ id: string | number }>).map((r) => String(r.id)));
    const got = new Set(submitted.map(String));
    return expected.size === got.size && submitted.length === got.size && [...expected].every((id) => got.has(id));
  };

  if (
    currentVersion !== data.fromKeyVersion ||
    !sameSet(secretIds.results, data.secrets.map((s) => s.id)) ||
    !sameSet(historyIds.results, data.history.map((h) => h.id)) ||
    !sameSet(memberIds.results, data.memberKeys.map((m) => m.userId)) ||
    !sameSet(contactIds.results, data.emergencyKeys.map((e) => e.contactId))
  ) {
    throw new HttpError(409, 'The vault changed while the key was being rotated. Please try again.', 'ROTATION_CONFLICT');
  }

  const audit = createAuditLogger(c);
  const statements: D1PreparedStatement[] = [];

  for (const chunk of chunkJson(data.secrets.map((s) => ({ id: s.id, c: s.ciphertextBlob, i: s.iv, v: s.encVersion })))) {
    statements.push(
      db
        .prepare(
          `UPDATE secrets SET
             ciphertext_blob = (SELECT json_extract(j.value, '$.c') FROM json_each(?1) j WHERE json_extract(j.value, '$.id') = secrets.id),
             iv = (SELECT json_extract(j.value, '$.i') FROM json_each(?1) j WHERE json_extract(j.value, '$.id') = secrets.id),
             enc_version = (SELECT json_extract(j.value, '$.v') FROM json_each(?1) j WHERE json_extract(j.value, '$.id') = secrets.id)
           WHERE org_id = ?2 AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`
        )
        .bind(chunk, orgId)
    );
  }

  for (const chunk of chunkJson(data.history.map((h) => ({ id: h.id, c: h.ciphertextBlob, i: h.iv, v: h.encVersion })))) {
    statements.push(
      db
        .prepare(
          `UPDATE secret_history SET
             ciphertext_blob = (SELECT json_extract(j.value, '$.c') FROM json_each(?1) j WHERE json_extract(j.value, '$.id') = secret_history.id),
             iv = (SELECT json_extract(j.value, '$.i') FROM json_each(?1) j WHERE json_extract(j.value, '$.id') = secret_history.id),
             enc_version = (SELECT json_extract(j.value, '$.v') FROM json_each(?1) j WHERE json_extract(j.value, '$.id') = secret_history.id)
           WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))
             AND secret_id IN (SELECT id FROM secrets WHERE org_id = ?2)`
        )
        .bind(chunk, orgId)
    );
  }

  statements.push(
    db
      .prepare(
        `UPDATE memberships SET encrypted_org_key =
           (SELECT json_extract(j.value, '$.k') FROM json_each(?1) j WHERE json_extract(j.value, '$.id') = memberships.user_id)
         WHERE org_id = ?2 AND status = 'active'`
      )
      .bind(JSON.stringify(data.memberKeys.map((m) => ({ id: m.userId, k: m.encryptedOrgKey }))), orgId)
  );

  if (data.emergencyKeys.length > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE emergency_contacts SET key_version = ?3, encrypted_org_key =
             (SELECT json_extract(j.value, '$.k') FROM json_each(?1) j WHERE json_extract(j.value, '$.id') = emergency_contacts.id)
           WHERE org_id = ?2 AND status = 'active'`
        )
        .bind(JSON.stringify(data.emergencyKeys.map((e) => ({ id: e.contactId, k: e.encryptedOrgKey }))), orgId, currentVersion + 1)
    );
  }

  // Pending invites were never given the old key; nothing to update there.
  statements.push(
    db.prepare('UPDATE organizations SET key_version = key_version + 1 WHERE id = ? AND key_version = ?').bind(orgId, currentVersion),
    auditStatement(
      db,
      audit.entry('ROTATE_ORG_KEY', {
        orgId,
        targetType: 'organization',
        targetId: orgId,
        metadata: {
          fromKeyVersion: currentVersion,
          secrets: data.secrets.length,
          history: data.history.length,
          members: data.memberKeys.length,
        },
      })
    )
  );

  if (statements.length > 45) {
    throw new HttpError(413, 'This vault is too large to rotate in one request on the free plan');
  }

  await db.batch(statements);
  return c.json({ success: true, keyVersion: currentVersion + 1 });
});
