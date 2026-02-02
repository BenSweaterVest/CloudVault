/**
 * Users Routes
 * 
 * Handles user profile management.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../index';
import { authMiddleware } from '../middleware/auth';
import { checkOrgAccess } from '../lib/db-utils';

export const usersRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// All routes require authentication
usersRoutes.use('*', authMiddleware);

/**
 * Get user's public key (for key exchange when adding to org)
 */
usersRoutes.get('/:orgId/users/:userId/public-key', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const userId = c.req.param('userId');
  
  // Check that requester is admin of the org
  const membership = await checkOrgAccess(c.env.DB, user.id, orgId, 'admin');
  
  if (!membership) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  
  // Check that target user is a member (or pending) of this org
  const targetMembership = await c.env.DB.prepare(
    'SELECT status FROM memberships WHERE user_id = ? AND org_id = ?'
  )
    .bind(userId, orgId)
    .first<{ status: string }>();
  
  if (!targetMembership) {
    return c.json({ error: 'User is not a member of this organization' }, 404);
  }
  
  // Get public key
  const targetUser = await c.env.DB.prepare(
    'SELECT id, email, name, public_key FROM users WHERE id = ?'
  )
    .bind(userId)
    .first<{
      id: string;
      email: string;
      name: string | null;
      public_key: string | null;
    }>();
  
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  return c.json({
    userId: targetUser.id,
    email: targetUser.email,
    name: targetUser.name,
    publicKey: targetUser.public_key,
    hasSetupKeys: !!targetUser.public_key,
  });
});

/**
 * Update user profile
 */
usersRoutes.patch('/:orgId/users/me', async (c) => {
  const user = c.get('user')!;
  const { name } = await c.req.json<{ name?: string }>();
  
  if (name !== undefined) {
    await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?')
      .bind(name, user.id)
      .run();
  }
  
  const updatedUser = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(user.id)
    .first<{
      id: string;
      email: string;
      name: string | null;
      public_key: string | null;
      encrypted_private_key: string | null;
      salt: string | null;
      auth_provider: string;
      created_at: string;
    }>();
  
  return c.json({
    id: updatedUser!.id,
    email: updatedUser!.email,
    name: updatedUser!.name,
    publicKey: updatedUser!.public_key,
    encryptedPrivateKey: updatedUser!.encrypted_private_key,
    salt: updatedUser!.salt,
    authProvider: updatedUser!.auth_provider,
    createdAt: updatedUser!.created_at,
  });
});
