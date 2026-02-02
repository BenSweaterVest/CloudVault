/**
 * Database Utility Functions
 * 
 * Shared utilities for common database operations to reduce code duplication
 * and improve performance.
 */

/**
 * Check if a user has access to an organization and meets role requirements.
 * 
 * This function consolidates the repeated membership query pattern found across
 * multiple route files. By extracting it here, we ensure consistent behavior
 * and make it easier to optimize or modify in the future.
 * 
 * @param db - D1 Database instance
 * @param userId - User ID to check
 * @param orgId - Organization ID to check
 * @param requiredRole - Optional role requirement ('admin' or 'member')
 * @returns Membership object with role if access is granted, null otherwise
 * 
 * @example
 * // Check if user has any access
 * const membership = await checkOrgAccess(db, userId, orgId);
 * 
 * @example
 * // Check if user is admin
 * const membership = await checkOrgAccess(db, userId, orgId, 'admin');
 * 
 * @example
 * // Check if user has member or admin role (excludes read_only)
 * const membership = await checkOrgAccess(db, userId, orgId, 'member');
 */
export async function checkOrgAccess(
  db: D1Database,
  userId: string,
  orgId: string,
  requiredRole?: 'admin' | 'member'
): Promise<{ role: string } | null> {
  const membership = await db
    .prepare(
      'SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND status = ?'
    )
    .bind(userId, orgId, 'active')
    .first<{ role: string }>();
  
  if (!membership) return null;
  
  // Admin role required - only admins pass
  if (requiredRole === 'admin' && membership.role !== 'admin') {
    return null;
  }
  
  // Member role required - admins and members pass, read_only does not
  if (requiredRole === 'member' && membership.role === 'read_only') {
    return null;
  }
  
  return membership;
}
