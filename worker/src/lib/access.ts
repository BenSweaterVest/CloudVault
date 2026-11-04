/**
 * Organization access control.
 *
 * Every org-scoped route calls requireMembership() with the minimum role it
 * needs. Roles are ordered: read_only < member < admin.
 */

import type { AppContext } from '../env';
import { getUser, HttpError } from './http';

export type Role = 'admin' | 'member' | 'read_only';

const ROLE_RANK: Record<Role, number> = {
  read_only: 0,
  member: 1,
  admin: 2,
};

export interface Membership {
  role: Role;
}

/**
 * Ensure the current user is an active member of the org with at least
 * `minRole`. Throws 403 otherwise. Returns the membership.
 */
export async function requireMembership(
  c: AppContext,
  orgId: string,
  minRole: Role = 'read_only'
): Promise<Membership> {
  const user = getUser(c);
  const membership = await c.env.DB.prepare(
    "SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND status = 'active'"
  )
    .bind(user.id, orgId)
    .first<{ role: Role }>();

  if (!membership) {
    throw new HttpError(403, 'Not a member of this organization');
  }

  if ((ROLE_RANK[membership.role] ?? -1) < ROLE_RANK[minRole]) {
    const message =
      minRole === 'admin' ? 'Admin access required' : 'Write access required';
    throw new HttpError(403, message);
  }

  return membership;
}

/** Number of active admins in an org. */
export async function countActiveAdmins(db: D1Database, orgId: string): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM memberships WHERE org_id = ? AND role = 'admin' AND status = 'active'"
    )
    .bind(orgId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
