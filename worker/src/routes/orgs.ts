/**
 * Organizations Routes
 * 
 * Handles organization CRUD and membership management.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../index';
import { authMiddleware } from '../middleware/auth';
import { createAuditLogger } from '../middleware/audit';

export const orgsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// All routes require authentication
orgsRoutes.use('*', authMiddleware);

// ============================================
// ORGANIZATION CRUD
// ============================================

/**
 * List user's organizations
 */
orgsRoutes.get('/', async (c) => {
  const user = c.get('user')!;
  
  const results = await c.env.DB.prepare(`
    SELECT 
      o.id,
      o.name,
      o.created_at,
      m.role,
      m.encrypted_org_key,
      m.status
    FROM organizations o
    JOIN memberships m ON o.id = m.org_id
    WHERE m.user_id = ? AND m.status = 'active'
    ORDER BY o.name
  `)
    .bind(user.id)
    .all<{
      id: string;
      name: string;
      created_at: string;
      role: string;
      encrypted_org_key: string;
      status: string;
    }>();
  
  return c.json(
    results.results.map((org) => ({
      id: org.id,
      name: org.name,
      role: org.role,
      encryptedOrgKey: org.encrypted_org_key,
      createdAt: org.created_at,
    }))
  );
});

/**
 * Create a new organization
 */
orgsRoutes.post('/', async (c) => {
  const user = c.get('user')!;
  const { name, encryptedOrgKey } = await c.req.json<{
    name: string;
    encryptedOrgKey: string;
  }>();

  if (!name || !encryptedOrgKey) {
    return c.json({ error: 'Name and encrypted org key are required' }, 400);
  }

  const orgId = crypto.randomUUID();
  const audit = createAuditLogger(c);

  // Use batch to ensure atomicity - both operations succeed or fail together
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)')
        .bind(orgId, name),
      c.env.DB.prepare(`
        INSERT INTO memberships (user_id, org_id, role, encrypted_org_key, status)
        VALUES (?, ?, 'admin', ?, 'active')
      `)
        .bind(user.id, orgId, encryptedOrgKey),
    ]);
  } catch (err) {
    console.error('Failed to create organization:', err instanceof Error ? err.message : 'unknown');
    return c.json({ error: 'Failed to create organization' }, 500);
  }

  // Log audit event
  audit.log('CREATE_ORG', {
    orgId,
    targetType: 'org',
    targetId: orgId,
    targetName: name,
  });

  return c.json({
    id: orgId,
    name,
    role: 'admin',
    encryptedOrgKey,
    createdAt: new Date().toISOString(),
  });
});

/**
 * Get organization details
 */
orgsRoutes.get('/:orgId', async (c) => {
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
  
  const org = await c.env.DB.prepare('SELECT * FROM organizations WHERE id = ?')
    .bind(orgId)
    .first<{ id: string; name: string; created_at: string }>();
  
  if (!org) {
    return c.json({ error: 'Organization not found' }, 404);
  }
  
  return c.json({
    id: org.id,
    name: org.name,
    role: membership.role,
    createdAt: org.created_at,
  });
});

// ============================================
// MEMBERSHIP MANAGEMENT
// ============================================

/**
 * List organization members
 */
orgsRoutes.get('/:orgId/members', async (c) => {
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
  
  const results = await c.env.DB.prepare(`
    SELECT 
      m.user_id,
      m.org_id,
      m.role,
      m.encrypted_org_key,
      m.status,
      m.created_at,
      u.email as user_email,
      u.name as user_name,
      u.public_key as user_public_key
    FROM memberships m
    JOIN users u ON m.user_id = u.id
    WHERE m.org_id = ?
    ORDER BY m.created_at
  `)
    .bind(orgId)
    .all<{
      user_id: string;
      org_id: string;
      role: string;
      encrypted_org_key: string | null;
      status: string;
      created_at: string;
      user_email: string;
      user_name: string | null;
      user_public_key: string | null;
    }>();
  
  return c.json(
    results.results.map((m) => ({
      userId: m.user_id,
      orgId: m.org_id,
      role: m.role,
      encryptedOrgKey: m.encrypted_org_key,
      status: m.status,
      userEmail: m.user_email,
      userName: m.user_name,
      userPublicKey: m.user_public_key,
      createdAt: m.created_at,
    }))
  );
});

/**
 * Invite a user to the organization
 */
orgsRoutes.post('/:orgId/members', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const { email } = await c.req.json<{ email: string }>();
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
  
  // Find or create user
  let invitedUser = await c.env.DB.prepare('SELECT id, email, name, public_key FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<{ id: string; email: string; name: string | null; public_key: string | null }>();
  
  if (!invitedUser) {
    // Create placeholder user
    const userId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, auth_provider) VALUES (?, ?, 'magic_link')`
    )
      .bind(userId, email.toLowerCase())
      .run();
    
    invitedUser = {
      id: userId,
      email: email.toLowerCase(),
      name: null,
      public_key: null,
    };
  }
  
  // Check if already a member
  const existingMembership = await c.env.DB.prepare(
    'SELECT status FROM memberships WHERE user_id = ? AND org_id = ?'
  )
    .bind(invitedUser.id, orgId)
    .first<{ status: string }>();
  
  if (existingMembership) {
    return c.json({ error: 'User is already a member or has pending invite' }, 400);
  }
  
  // Create pending membership
  await c.env.DB.prepare(`
    INSERT INTO memberships (user_id, org_id, role, status, invited_by)
    VALUES (?, ?, 'member', 'pending', ?)
  `)
    .bind(invitedUser.id, orgId, user.id)
    .run();
  
  // Log audit event
  audit.log('INVITE_USER', {
    orgId,
    targetType: 'user',
    targetId: invitedUser.id,
    targetName: email,
  });
  
  return c.json({
    userId: invitedUser.id,
    orgId,
    role: 'member',
    encryptedOrgKey: null,
    status: 'pending',
    userEmail: invitedUser.email,
    userName: invitedUser.name,
    userPublicKey: invitedUser.public_key,
    createdAt: new Date().toISOString(),
  });
});

/**
 * Approve pending user and grant access
 */
orgsRoutes.post('/:orgId/members/:userId/approve', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const userId = c.req.param('userId');
  const { encryptedOrgKey } = await c.req.json<{ encryptedOrgKey: string }>();
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
  
  // Check pending membership exists
  const pendingMembership = await c.env.DB.prepare(
    'SELECT * FROM memberships WHERE user_id = ? AND org_id = ? AND status = ?'
  )
    .bind(userId, orgId, 'pending')
    .first();
  
  if (!pendingMembership) {
    return c.json({ error: 'No pending membership found' }, 404);
  }
  
  // Approve membership
  await c.env.DB.prepare(
    'UPDATE memberships SET status = ?, encrypted_org_key = ? WHERE user_id = ? AND org_id = ?'
  )
    .bind('active', encryptedOrgKey, userId, orgId)
    .run();
  
  // Get user info
  const approvedUser = await c.env.DB.prepare('SELECT email, name FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string; name: string | null }>();
  
  // Log audit event
  audit.log('APPROVE_USER', {
    orgId,
    targetType: 'user',
    targetId: userId,
    targetName: approvedUser?.email,
  });
  
  return c.json({
    userId,
    orgId,
    role: 'member',
    encryptedOrgKey,
    status: 'active',
    userEmail: approvedUser?.email,
    userName: approvedUser?.name,
    createdAt: new Date().toISOString(),
  });
});

/**
 * Update user role
 */
orgsRoutes.patch('/:orgId/members/:userId', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const userId = c.req.param('userId');
  const { role } = await c.req.json<{ role: 'admin' | 'member' | 'read_only' }>();
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
  
  // Can't change your own role
  if (userId === user.id) {
    return c.json({ error: "Can't change your own role" }, 400);
  }
  
  // Update role
  await c.env.DB.prepare('UPDATE memberships SET role = ? WHERE user_id = ? AND org_id = ?')
    .bind(role, userId, orgId)
    .run();
  
  // Get user info
  const targetUser = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string }>();
  
  // Log audit event
  audit.log('UPDATE_USER_ROLE', {
    orgId,
    targetType: 'membership',
    targetId: userId,
    targetName: targetUser?.email,
    metadata: { newRole: role },
  });
  
  return c.json({ success: true, role });
});

/**
 * Remove user from organization
 */
orgsRoutes.delete('/:orgId/members/:userId', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const userId = c.req.param('userId');
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
  
  // Can't remove yourself
  if (userId === user.id) {
    return c.json({ error: "Can't remove yourself" }, 400);
  }
  
  // Get user info before deletion
  const targetUser = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string }>();
  
  // Remove membership
  await c.env.DB.prepare('DELETE FROM memberships WHERE user_id = ? AND org_id = ?')
    .bind(userId, orgId)
    .run();
  
  // Log audit event
  audit.log('REMOVE_USER', {
    orgId,
    targetType: 'user',
    targetId: userId,
    targetName: targetUser?.email,
  });
  
  return c.json({ success: true });
});

// ============================================
// ORGANIZATION DELETION
// ============================================

/**
 * Delete an organization
 * 
 * Only the organization admin can delete the organization.
 * This will cascade delete all:
 * - Secrets
 * - Secret history
 * - Categories
 * - Memberships
 * - Share links
 * - Emergency contacts/requests
 * - Organization settings
 * - Audit logs (optionally preserved)
 * 
 * @route DELETE /:orgId
 */
orgsRoutes.delete('/:orgId', async (c) => {
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
  
  // Get organization info for audit
  const org = await c.env.DB.prepare('SELECT name FROM organizations WHERE id = ?')
    .bind(orgId)
    .first<{ name: string }>();
  
  if (!org) {
    return c.json({ error: 'Organization not found' }, 404);
  }
  
  // Check if this is the only admin (currently unused but kept for future feature)
  // const adminCount = await c.env.DB.prepare(
  //   'SELECT COUNT(*) as count FROM memberships WHERE org_id = ? AND role = ? AND status = ?'
  // )
  //   .bind(orgId, 'admin', 'active')
  //   .first<{ count: number }>();
  
  // Get member count for confirmation
  const memberCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM memberships WHERE org_id = ? AND status = ?'
  )
    .bind(orgId, 'active')
    .first<{ count: number }>();
  
  // Get secret count for confirmation
  const secretCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM secrets WHERE org_id = ?'
  )
    .bind(orgId)
    .first<{ count: number }>();
  
  // Log the deletion BEFORE actually deleting (so we have the audit record)
  audit.log('DELETE_ORG', {
    orgId,
    targetType: 'organization',
    targetId: orgId,
    targetName: org.name,
    metadata: {
      memberCount: memberCount?.count || 0,
      secretCount: secretCount?.count || 0,
    },
  });
  
  // Delete in order (respecting foreign key constraints)
  // Using batch operations for better performance - reduces DB roundtrips from 10+ to 1
  await c.env.DB.batch([
    // Delete share links
    c.env.DB.prepare('DELETE FROM share_links WHERE org_id = ?').bind(orgId),
    
    // Delete emergency requests and contacts
    c.env.DB.prepare('DELETE FROM emergency_requests WHERE org_id = ?').bind(orgId),
    c.env.DB.prepare('DELETE FROM emergency_contacts WHERE org_id = ?').bind(orgId),
    
    // Delete organization settings
    c.env.DB.prepare('DELETE FROM organization_settings WHERE org_id = ?').bind(orgId),
    
    // Delete custom field values and definitions
    c.env.DB.prepare(`
      DELETE FROM custom_field_values 
      WHERE secret_id IN (SELECT id FROM secrets WHERE org_id = ?)
    `).bind(orgId),
    c.env.DB.prepare('DELETE FROM custom_field_definitions WHERE org_id = ?').bind(orgId),
    
    // Delete secret history
    c.env.DB.prepare(`
      DELETE FROM secret_history 
      WHERE secret_id IN (SELECT id FROM secrets WHERE org_id = ?)
    `).bind(orgId),
    
    // Delete secrets
    c.env.DB.prepare('DELETE FROM secrets WHERE org_id = ?').bind(orgId),
    
    // Delete categories
    c.env.DB.prepare('DELETE FROM categories WHERE org_id = ?').bind(orgId),
    
    // Delete memberships
    c.env.DB.prepare('DELETE FROM memberships WHERE org_id = ?').bind(orgId),
    
    // Finally, delete the organization
    c.env.DB.prepare('DELETE FROM organizations WHERE id = ?').bind(orgId),
  ]);
  
  return c.json({ 
    success: true, 
    message: `Organization "${org.name}" has been deleted`,
    deleted: {
      members: memberCount?.count || 0,
      secrets: secretCount?.count || 0,
    }
  });
});
