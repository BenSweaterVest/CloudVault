/**
 * Categories for organizing secrets.
 *
 * Mounted on the authenticated org router at /api/organizations.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireMembership } from '../lib/access';
import { createAuditLogger } from '../middleware/audit';
import { HttpError, param } from '../lib/http';
import { createCategorySchema, updateCategorySchema, validateBody } from '../lib/validation';

export const categoriesRoutes = new Hono<AppEnv>();

interface CategoryRow {
  id: string;
  org_id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  created_at: string;
  secret_count?: number;
}

function serializeCategory(cat: CategoryRow) {
  return {
    id: cat.id,
    orgId: cat.org_id,
    name: cat.name,
    icon: cat.icon,
    color: cat.color,
    sortOrder: cat.sort_order,
    secretCount: cat.secret_count ?? 0,
    createdAt: cat.created_at,
  };
}

async function loadCategory(db: D1Database, orgId: string, categoryId: string): Promise<CategoryRow> {
  const row = await db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM secrets s WHERE s.category_id = c.id) AS secret_count
       FROM categories c WHERE c.id = ? AND c.org_id = ?`
    )
    .bind(categoryId, orgId)
    .first<CategoryRow>();
  if (!row) throw new HttpError(404, 'Category not found');
  return row;
}

categoriesRoutes.get('/:orgId/categories', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId);
  const results = await c.env.DB.prepare(
    `SELECT c.*, COUNT(s.id) AS secret_count
     FROM categories c LEFT JOIN secrets s ON c.id = s.category_id
     WHERE c.org_id = ?
     GROUP BY c.id
     ORDER BY c.sort_order, c.name COLLATE NOCASE`
  )
    .bind(orgId)
    .all<CategoryRow>();
  return c.json(results.results.map(serializeCategory));
});

categoriesRoutes.post('/:orgId/categories', async (c) => {
  const orgId = param(c, 'orgId');
  await requireMembership(c, orgId, 'member');
  const data = await validateBody(c, createCategorySchema);
  const categoryId = crypto.randomUUID();

  await c.env.DB.prepare(
    `INSERT INTO categories (id, org_id, name, icon, color, sort_order)
     VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories WHERE org_id = ?))`
  )
    .bind(categoryId, orgId, data.name, data.icon, data.color, orgId)
    .run();

  createAuditLogger(c).log('CREATE_CATEGORY', { orgId, targetType: 'category', targetId: categoryId, targetName: data.name });
  return c.json(serializeCategory(await loadCategory(c.env.DB, orgId, categoryId)), 201);
});

categoriesRoutes.put('/:orgId/categories/:categoryId', async (c) => {
  const orgId = param(c, 'orgId');
  const categoryId = param(c, 'categoryId');
  await requireMembership(c, orgId, 'member');
  await loadCategory(c.env.DB, orgId, categoryId);
  const data = await validateBody(c, updateCategorySchema);

  const updates: string[] = [];
  const values: (string | number)[] = [];
  if (data.name !== undefined) (updates.push('name = ?'), values.push(data.name));
  if (data.icon !== undefined) (updates.push('icon = ?'), values.push(data.icon));
  if (data.color !== undefined) (updates.push('color = ?'), values.push(data.color));
  if (data.sortOrder !== undefined) (updates.push('sort_order = ?'), values.push(data.sortOrder));

  if (updates.length > 0) {
    await c.env.DB.prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`)
      .bind(...values, categoryId, orgId)
      .run();
  }

  const updated = await loadCategory(c.env.DB, orgId, categoryId);
  createAuditLogger(c).log('UPDATE_CATEGORY', { orgId, targetType: 'category', targetId: categoryId, targetName: updated.name });
  return c.json(serializeCategory(updated));
});

categoriesRoutes.delete('/:orgId/categories/:categoryId', async (c) => {
  const orgId = param(c, 'orgId');
  const categoryId = param(c, 'categoryId');
  await requireMembership(c, orgId, 'admin');
  const category = await loadCategory(c.env.DB, orgId, categoryId);

  await c.env.DB.batch([
    // Explicit, rather than relying on ON DELETE SET NULL being enforced.
    c.env.DB.prepare('UPDATE secrets SET category_id = NULL WHERE category_id = ? AND org_id = ?').bind(categoryId, orgId),
    c.env.DB.prepare('DELETE FROM categories WHERE id = ? AND org_id = ?').bind(categoryId, orgId),
  ]);

  createAuditLogger(c).log('DELETE_CATEGORY', { orgId, targetType: 'category', targetId: categoryId, targetName: category.name });
  return c.json({ success: true });
});
