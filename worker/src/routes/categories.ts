/**
 * Categories Routes
 * 
 * CRUD operations for organizing secrets into categories.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../index';
import { authMiddleware } from '../middleware/auth';
import { createAuditLogger } from '../middleware/audit';
import { validateBody, createCategorySchema, updateCategorySchema } from '../lib/validation';

export const categoriesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// All routes require authentication
categoriesRoutes.use('*', authMiddleware);

/**
 * List categories for an organization
 */
categoriesRoutes.get('/:orgId/categories', async (c) => {
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
  
  const results = await c.env.DB.prepare(`
    SELECT 
      c.*,
      COUNT(s.id) as secret_count
    FROM categories c
    LEFT JOIN secrets s ON c.id = s.category_id
    WHERE c.org_id = ?
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `)
    .bind(orgId)
    .all<{
      id: string;
      org_id: string;
      name: string;
      icon: string;
      color: string;
      sort_order: number;
      created_at: string;
      secret_count: number;
    }>();
  
  return c.json(
    results.results.map((cat) => ({
      id: cat.id,
      orgId: cat.org_id,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      sortOrder: cat.sort_order,
      secretCount: cat.secret_count,
      createdAt: cat.created_at,
    }))
  );
});

/**
 * Create a new category
 */
categoriesRoutes.post('/:orgId/categories', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const audit = createAuditLogger(c);
  
  // Check admin access
  const membership = await c.env.DB.prepare(
    'SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND status = ?'
  )
    .bind(user.id, orgId, 'active')
    .first<{ role: string }>();
  
  if (!membership || membership.role === 'read_only') {
    return c.json({ error: 'Write access required' }, 403);
  }
  
  const data = await validateBody(c, createCategorySchema);
  const categoryId = crypto.randomUUID();
  
  // Get max sort order
  const maxOrder = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM categories WHERE org_id = ?'
  )
    .bind(orgId)
    .first<{ max_order: number | null }>();
  
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;
  
  await c.env.DB.prepare(`
    INSERT INTO categories (id, org_id, name, icon, color, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(categoryId, orgId, data.name, data.icon, data.color, sortOrder)
    .run();
  
  audit.log('CREATE_CATEGORY', {
    orgId,
    targetType: 'category',
    targetId: categoryId,
    targetName: data.name,
  });
  
  return c.json({
    id: categoryId,
    orgId,
    name: data.name,
    icon: data.icon,
    color: data.color,
    sortOrder,
    secretCount: 0,
    createdAt: new Date().toISOString(),
  });
});

/**
 * Update a category
 */
categoriesRoutes.put('/:orgId/categories/:categoryId', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const categoryId = c.req.param('categoryId');
  const audit = createAuditLogger(c);
  
  // Check admin access
  const membership = await c.env.DB.prepare(
    'SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND status = ?'
  )
    .bind(user.id, orgId, 'active')
    .first<{ role: string }>();
  
  if (!membership || membership.role === 'read_only') {
    return c.json({ error: 'Write access required' }, 403);
  }
  
  // Verify category exists and belongs to org
  const existing = await c.env.DB.prepare(
    'SELECT * FROM categories WHERE id = ? AND org_id = ?'
  )
    .bind(categoryId, orgId)
    .first();
  
  if (!existing) {
    return c.json({ error: 'Category not found' }, 404);
  }
  
  const data = await validateBody(c, updateCategorySchema);
  
  // Build update query
  const updates: string[] = [];
  const values: (string | number)[] = [];
  
  if (data.name !== undefined) {
    updates.push('name = ?');
    values.push(data.name);
  }
  if (data.icon !== undefined) {
    updates.push('icon = ?');
    values.push(data.icon);
  }
  if (data.color !== undefined) {
    updates.push('color = ?');
    values.push(data.color);
  }
  if (data.sortOrder !== undefined) {
    updates.push('sort_order = ?');
    values.push(data.sortOrder);
  }
  
  if (updates.length > 0) {
    values.push(categoryId, orgId);
    await c.env.DB.prepare(
      `UPDATE categories SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`
    )
      .bind(...values)
      .run();
  }
  
  const updated = await c.env.DB.prepare(
    'SELECT * FROM categories WHERE id = ?'
  )
    .bind(categoryId)
    .first<{
      id: string;
      org_id: string;
      name: string;
      icon: string;
      color: string;
      sort_order: number;
      created_at: string;
    }>();
  
  audit.log('UPDATE_CATEGORY', {
    orgId,
    targetType: 'category',
    targetId: categoryId,
    targetName: updated?.name,
  });
  
  return c.json({
    id: updated!.id,
    orgId: updated!.org_id,
    name: updated!.name,
    icon: updated!.icon,
    color: updated!.color,
    sortOrder: updated!.sort_order,
    createdAt: updated!.created_at,
  });
});

/**
 * Delete a category
 */
categoriesRoutes.delete('/:orgId/categories/:categoryId', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const categoryId = c.req.param('categoryId');
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
  
  // Get category name for audit
  const category = await c.env.DB.prepare(
    'SELECT name FROM categories WHERE id = ? AND org_id = ?'
  )
    .bind(categoryId, orgId)
    .first<{ name: string }>();
  
  if (!category) {
    return c.json({ error: 'Category not found' }, 404);
  }
  
  // Delete category (secrets will have category_id set to NULL due to ON DELETE SET NULL)
  await c.env.DB.prepare('DELETE FROM categories WHERE id = ? AND org_id = ?')
    .bind(categoryId, orgId)
    .run();
  
  audit.log('DELETE_CATEGORY', {
    orgId,
    targetType: 'category',
    targetId: categoryId,
    targetName: category.name,
  });
  
  return c.json({ success: true });
});
