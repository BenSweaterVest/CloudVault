/**
 * Secrets Routes
 * 
 * Handles CRUD operations for encrypted secrets.
 * Note: All secret data is encrypted client-side - server only sees ciphertext.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../index';
import { authMiddleware } from '../middleware/auth';
import { createAuditLogger } from '../middleware/audit';
import { validateBody, createSecretSchema, updateSecretSchema, toggleFavoriteSchema } from '../lib/validation';

export const secretsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// All routes require authentication
secretsRoutes.use('*', authMiddleware);

// ============================================
// HELPER: Check Organization Access
// ============================================

async function checkOrgAccess(
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
  
  if (requiredRole === 'admin' && membership.role !== 'admin') {
    return null;
  }
  
  if (requiredRole === 'member' && membership.role === 'read_only') {
    return null;
  }
  
  return membership;
}

// ============================================
// SECRET TYPE DEFINITIONS
// ============================================

interface SecretRow {
  id: string;
  org_id: string;
  name: string;
  url: string | null;
  username_hint: string | null;
  ciphertext_blob: string;
  iv: string;
  version: number;
  created_by: string;
  updated_at: string;
  category_id: string | null;
  is_favorite: number;
  secret_type: string;
  expires_at: string | null;
  tags: string | null;
}

/**
 * Safely parse JSON with fallback to empty array
 */
function safeParseJsonArray(json: string | null): unknown[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Data corruption - return empty array rather than crash
    return [];
  }
}

function mapSecretRow(s: SecretRow) {
  return {
    id: s.id,
    orgId: s.org_id,
    name: s.name,
    url: s.url,
    usernameHint: s.username_hint,
    ciphertextBlob: s.ciphertext_blob,
    iv: s.iv,
    version: s.version,
    createdBy: s.created_by,
    updatedAt: s.updated_at,
    categoryId: s.category_id,
    isFavorite: s.is_favorite === 1,
    secretType: s.secret_type,
    expiresAt: s.expires_at,
    tags: safeParseJsonArray(s.tags),
  };
}

// ============================================
// SECRETS CRUD
// ============================================

/**
 * List secrets in an organization
 */
secretsRoutes.get('/:orgId/secrets', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  
  // Parse query params for filtering
  const url = new URL(c.req.url);
  const categoryId = url.searchParams.get('categoryId');
  const secretType = url.searchParams.get('type');
  const favoritesOnly = url.searchParams.get('favorites') === 'true';
  const search = url.searchParams.get('search')?.toLowerCase();
  
  // Check access
  const membership = await checkOrgAccess(c.env.DB, user.id, orgId);
  if (!membership) {
    return c.json({ error: 'Access denied' }, 403);
  }
  
  // Build query with filters
  let query = `
    SELECT 
      s.*,
      c.name as category_name,
      c.color as category_color
    FROM secrets s
    LEFT JOIN categories c ON s.category_id = c.id
    WHERE s.org_id = ?
  `;
  const params: (string | number)[] = [orgId];
  
  if (categoryId) {
    query += ' AND s.category_id = ?';
    params.push(categoryId);
  }
  
  if (secretType) {
    query += ' AND s.secret_type = ?';
    params.push(secretType);
  }
  
  if (favoritesOnly) {
    query += ' AND s.is_favorite = 1';
  }
  
  query += ' ORDER BY s.is_favorite DESC, s.name';
  
  const results = await c.env.DB.prepare(query)
    .bind(...params)
    .all<SecretRow & { category_name: string | null; category_color: string | null }>();
  
  let secrets = results.results.map((s) => ({
    ...mapSecretRow(s),
    categoryName: s.category_name,
    categoryColor: s.category_color,
  }));
  
  // Client-side search filter (since data is encrypted)
  if (search) {
    secrets = secrets.filter(
      (s) =>
        s.name.toLowerCase().includes(search) ||
        s.url?.toLowerCase().includes(search) ||
        s.usernameHint?.toLowerCase().includes(search) ||
        s.tags.some((t: string) => t.toLowerCase().includes(search))
    );
  }
  
  return c.json(secrets);
});

/**
 * Get a single secret
 */
secretsRoutes.get('/:orgId/secrets/:secretId', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const secretId = c.req.param('secretId');
  const audit = createAuditLogger(c);
  
  // Check access
  const membership = await checkOrgAccess(c.env.DB, user.id, orgId);
  if (!membership) {
    return c.json({ error: 'Access denied' }, 403);
  }
  
  const secret = await c.env.DB.prepare(
    'SELECT * FROM secrets WHERE id = ? AND org_id = ?'
  )
    .bind(secretId, orgId)
    .first<SecretRow>();
  
  if (!secret) {
    return c.json({ error: 'Secret not found' }, 404);
  }
  
  // Log view event
  audit.log('VIEW_SECRET', {
    orgId,
    targetType: 'secret',
    targetId: secretId,
    targetName: secret.name,
  });
  
  return c.json(mapSecretRow(secret));
});

/**
 * Create a new secret
 */
secretsRoutes.post('/:orgId/secrets', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const audit = createAuditLogger(c);
  
  // Check write access (not read_only)
  const membership = await checkOrgAccess(c.env.DB, user.id, orgId, 'member');
  if (!membership) {
    return c.json({ error: 'Write access required' }, 403);
  }
  
  const data = await validateBody(c, createSecretSchema);
  const secretId = crypto.randomUUID();
  
  await c.env.DB.prepare(`
    INSERT INTO secrets (
      id, org_id, name, url, username_hint, ciphertext_blob, iv, 
      created_by, category_id, secret_type, tags, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      secretId,
      orgId,
      data.name,
      data.url || null,
      data.usernameHint || null,
      data.ciphertextBlob,
      data.iv,
      user.id,
      data.categoryId || null,
      data.secretType,
      data.tags ? JSON.stringify(data.tags) : null,
      data.expiresAt || null
    )
    .run();
  
  // Log create event
  audit.log('CREATE_SECRET', {
    orgId,
    targetType: 'secret',
    targetId: secretId,
    targetName: data.name,
    metadata: { secretType: data.secretType },
  });
  
  return c.json({
    id: secretId,
    orgId,
    name: data.name,
    url: data.url || null,
    usernameHint: data.usernameHint || null,
    ciphertextBlob: data.ciphertextBlob,
    iv: data.iv,
    version: 1,
    createdBy: user.id,
    updatedAt: new Date().toISOString(),
    categoryId: data.categoryId || null,
    isFavorite: false,
    secretType: data.secretType,
    expiresAt: data.expiresAt || null,
    tags: data.tags || [],
  });
});

/**
 * Update a secret
 */
secretsRoutes.put('/:orgId/secrets/:secretId', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const secretId = c.req.param('secretId');
  const audit = createAuditLogger(c);
  
  // Check write access
  const membership = await checkOrgAccess(c.env.DB, user.id, orgId, 'member');
  if (!membership) {
    return c.json({ error: 'Write access required' }, 403);
  }
  
  // Get current secret
  const currentSecret = await c.env.DB.prepare(
    'SELECT * FROM secrets WHERE id = ? AND org_id = ?'
  )
    .bind(secretId, orgId)
    .first<SecretRow>();
  
  if (!currentSecret) {
    return c.json({ error: 'Secret not found' }, 404);
  }
  
  const data = await validateBody(c, updateSecretSchema);
  
  // If ciphertext is changing, save to history
  if (data.ciphertextBlob && data.ciphertextBlob !== currentSecret.ciphertext_blob) {
    await c.env.DB.prepare(`
      INSERT INTO secret_history (secret_id, version, ciphertext_blob, iv, changed_by)
      VALUES (?, ?, ?, ?, ?)
    `)
      .bind(
        secretId,
        currentSecret.version,
        currentSecret.ciphertext_blob,
        currentSecret.iv,
        user.id
      )
      .run();
  }
  
  // Build update query dynamically
  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (data.name !== undefined) {
    updates.push('name = ?');
    values.push(data.name);
  }
  if (data.url !== undefined) {
    updates.push('url = ?');
    values.push(data.url || null);
  }
  if (data.usernameHint !== undefined) {
    updates.push('username_hint = ?');
    values.push(data.usernameHint || null);
  }
  if (data.ciphertextBlob !== undefined) {
    updates.push('ciphertext_blob = ?');
    values.push(data.ciphertextBlob);
  }
  if (data.iv !== undefined) {
    updates.push('iv = ?');
    values.push(data.iv);
  }
  if (data.categoryId !== undefined) {
    updates.push('category_id = ?');
    values.push(data.categoryId);
  }
  if (data.secretType !== undefined) {
    updates.push('secret_type = ?');
    values.push(data.secretType);
  }
  if (data.tags !== undefined) {
    updates.push('tags = ?');
    values.push(JSON.stringify(data.tags));
  }
  if (data.expiresAt !== undefined) {
    updates.push('expires_at = ?');
    values.push(data.expiresAt);
  }
  if (data.isFavorite !== undefined) {
    updates.push('is_favorite = ?');
    values.push(data.isFavorite ? 1 : 0);
  }
  
  // Increment version and update timestamp
  if (data.ciphertextBlob) {
    updates.push('version = version + 1');
  }
  updates.push('updated_at = CURRENT_TIMESTAMP');
  
  // Add WHERE clause values
  values.push(secretId, orgId);
  
  await c.env.DB.prepare(
    `UPDATE secrets SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`
  )
    .bind(...values)
    .run();
  
  // Get updated secret
  const updatedSecret = await c.env.DB.prepare(
    'SELECT * FROM secrets WHERE id = ?'
  )
    .bind(secretId)
    .first<SecretRow>();
  
  // Log update event
  audit.log('UPDATE_SECRET', {
    orgId,
    targetType: 'secret',
    targetId: secretId,
    targetName: updatedSecret!.name,
  });
  
  return c.json(mapSecretRow(updatedSecret!));
});

/**
 * Toggle favorite status
 */
secretsRoutes.patch('/:orgId/secrets/:secretId/favorite', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const secretId = c.req.param('secretId');
  
  // Check access (any member can favorite)
  const membership = await checkOrgAccess(c.env.DB, user.id, orgId);
  if (!membership) {
    return c.json({ error: 'Access denied' }, 403);
  }
  
  const data = await validateBody(c, toggleFavoriteSchema);
  
  await c.env.DB.prepare(
    'UPDATE secrets SET is_favorite = ? WHERE id = ? AND org_id = ?'
  )
    .bind(data.isFavorite ? 1 : 0, secretId, orgId)
    .run();
  
  return c.json({ success: true, isFavorite: data.isFavorite });
});

/**
 * Delete a secret
 */
secretsRoutes.delete('/:orgId/secrets/:secretId', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const secretId = c.req.param('secretId');
  const audit = createAuditLogger(c);
  
  // Check write access
  const membership = await checkOrgAccess(c.env.DB, user.id, orgId, 'member');
  if (!membership) {
    return c.json({ error: 'Write access required' }, 403);
  }
  
  // Get secret name for audit
  const secret = await c.env.DB.prepare(
    'SELECT name FROM secrets WHERE id = ? AND org_id = ?'
  )
    .bind(secretId, orgId)
    .first<{ name: string }>();
  
  if (!secret) {
    return c.json({ error: 'Secret not found' }, 404);
  }
  
  // Delete secret (history is cascade deleted)
  await c.env.DB.prepare('DELETE FROM secrets WHERE id = ? AND org_id = ?')
    .bind(secretId, orgId)
    .run();
  
  // Log delete event
  audit.log('DELETE_SECRET', {
    orgId,
    targetType: 'secret',
    targetId: secretId,
    targetName: secret.name,
  });
  
  return c.json({ success: true });
});

/**
 * Get secret history
 */
secretsRoutes.get('/:orgId/secrets/:secretId/history', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const secretId = c.req.param('secretId');
  const audit = createAuditLogger(c);
  
  // Check access
  const membership = await checkOrgAccess(c.env.DB, user.id, orgId);
  if (!membership) {
    return c.json({ error: 'Access denied' }, 403);
  }
  
  // Get secret name
  const secret = await c.env.DB.prepare(
    'SELECT name FROM secrets WHERE id = ? AND org_id = ?'
  )
    .bind(secretId, orgId)
    .first<{ name: string }>();
  
  if (!secret) {
    return c.json({ error: 'Secret not found' }, 404);
  }
  
  const results = await c.env.DB.prepare(`
    SELECT 
      h.id,
      h.secret_id,
      h.version,
      h.ciphertext_blob,
      h.iv,
      h.changed_by,
      h.created_at,
      u.email as changed_by_email
    FROM secret_history h
    LEFT JOIN users u ON h.changed_by = u.id
    WHERE h.secret_id = ?
    ORDER BY h.version DESC
  `)
    .bind(secretId)
    .all<{
      id: number;
      secret_id: string;
      version: number;
      ciphertext_blob: string;
      iv: string;
      changed_by: string;
      created_at: string;
      changed_by_email: string;
    }>();
  
  // Log history view
  audit.log('VIEW_SECRET_HISTORY', {
    orgId,
    targetType: 'secret',
    targetId: secretId,
    targetName: secret.name,
  });
  
  return c.json(
    results.results.map((h) => ({
      id: h.id,
      secretId: h.secret_id,
      version: h.version,
      ciphertextBlob: h.ciphertext_blob,
      iv: h.iv,
      changedBy: h.changed_by,
      changedByEmail: h.changed_by_email,
      createdAt: h.created_at,
    }))
  );
});

/**
 * Get expiring secrets
 */
secretsRoutes.get('/:orgId/secrets/expiring', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  
  // Check access
  const membership = await checkOrgAccess(c.env.DB, user.id, orgId);
  if (!membership) {
    return c.json({ error: 'Access denied' }, 403);
  }
  
  // Get secrets expiring in the next 30 days
  const results = await c.env.DB.prepare(`
    SELECT * FROM secrets 
    WHERE org_id = ? 
    AND expires_at IS NOT NULL 
    AND expires_at <= datetime('now', '+30 days')
    ORDER BY expires_at
  `)
    .bind(orgId)
    .all<SecretRow>();
  
  return c.json(results.results.map(mapSecretRow));
});

// ============================================
// IMPORT/EXPORT ENDPOINTS
// ============================================

/**
 * Export secrets (encrypted)
 * 
 * Returns all secrets in the organization as encrypted JSON.
 * Client must decrypt the data - server only provides ciphertext.
 * 
 * @route GET /:orgId/secrets/export
 * @returns Array of encrypted secrets
 */
secretsRoutes.get('/:orgId/secrets/export', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const audit = createAuditLogger(c);
  
  // Check access (member+ required)
  const membership = await checkOrgAccess(c.env.DB, user.id, orgId);
  if (!membership) {
    return c.json({ error: 'Access denied' }, 403);
  }
  
  // Get all secrets with category info
  const results = await c.env.DB.prepare(`
    SELECT s.*, c.name as category_name, c.color as category_color
    FROM secrets s
    LEFT JOIN categories c ON s.category_id = c.id
    WHERE s.org_id = ?
    ORDER BY s.name
  `)
    .bind(orgId)
    .all<SecretRow & { category_name: string | null; category_color: string | null }>();
  
  // Log export action
  audit.log('EXPORT_SECRETS', {
    orgId,
    targetType: 'organization',
    targetId: orgId,
    metadata: { count: results.results.length },
  });
  
  // Return encrypted secrets with metadata
  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    orgId,
    secrets: results.results.map((s) => ({
      name: s.name,
      url: s.url,
      usernameHint: s.username_hint,
      ciphertextBlob: s.ciphertext_blob,
      iv: s.iv,
      secretType: s.secret_type,
      categoryName: s.category_name,
      tags: s.tags ? JSON.parse(s.tags) : [],
      expiresAt: s.expires_at,
      createdAt: s.created_at,
    })),
  };
  
  return c.json(exportData);
});

/**
 * Import secrets (encrypted)
 * 
 * Imports secrets from various formats. The client is responsible for:
 * 1. Parsing the source format (Bitwarden, LastPass, etc.)
 * 2. Encrypting the data with the org key
 * 3. Sending encrypted ciphertext to this endpoint
 * 
 * @route POST /:orgId/secrets/import
 * @body { secrets: Array<{ name, ciphertextBlob, iv, ... }>, categoryId?: string }
 */
secretsRoutes.post('/:orgId/secrets/import', async (c) => {
  const user = c.get('user')!;
  const orgId = c.req.param('orgId');
  const audit = createAuditLogger(c);
  
  // Check access (member+ required)
  const membership = await checkOrgAccess(c.env.DB, user.id, orgId, 'member');
  if (!membership) {
    return c.json({ error: 'Access denied' }, 403);
  }
  
  // Parse request body
  const body = await c.req.json<{
    secrets: Array<{
      name: string;
      url?: string;
      usernameHint?: string;
      ciphertextBlob: string;
      iv: string;
      secretType?: string;
      tags?: string[];
      expiresAt?: string;
    }>;
    categoryId?: string;
  }>();
  
  if (!body.secrets || !Array.isArray(body.secrets)) {
    return c.json({ error: 'Invalid import data: secrets array required' }, 400);
  }
  
  if (body.secrets.length === 0) {
    return c.json({ error: 'No secrets to import' }, 400);
  }
  
  if (body.secrets.length > 500) {
    return c.json({ error: 'Import limit is 500 secrets per request' }, 400);
  }
  
  // Validate category if provided
  if (body.categoryId) {
    const category = await c.env.DB.prepare(
      'SELECT id FROM categories WHERE id = ? AND org_id = ?'
    )
      .bind(body.categoryId, orgId)
      .first();
    
    if (!category) {
      return c.json({ error: 'Category not found' }, 404);
    }
  }
  
  // Import secrets in a batch
  const imported: string[] = [];
  const errors: Array<{ index: number; name: string; error: string }> = [];
  
  for (let i = 0; i < body.secrets.length; i++) {
    const secret = body.secrets[i];
    
    // Validate required fields
    if (!secret.name || !secret.ciphertextBlob || !secret.iv) {
      errors.push({ 
        index: i, 
        name: secret.name || `Secret ${i + 1}`,
        error: 'Missing required fields (name, ciphertextBlob, iv)'
      });
      continue;
    }
    
    try {
      const secretId = crypto.randomUUID();
      const secretType = secret.secretType || 'password';
      const tags = secret.tags ? JSON.stringify(secret.tags) : null;
      
      await c.env.DB.prepare(`
        INSERT INTO secrets (
          id, org_id, name, url, username_hint, ciphertext_blob, iv,
          version, created_by, category_id, secret_type, tags, expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      `)
        .bind(
          secretId,
          orgId,
          secret.name.slice(0, 200),
          secret.url || null,
          secret.usernameHint?.slice(0, 200) || null,
          secret.ciphertextBlob,
          secret.iv,
          user.id,
          body.categoryId || null,
          secretType,
          tags,
          secret.expiresAt || null
        )
        .run();
      
      imported.push(secretId);
    } catch (err) {
      errors.push({
        index: i,
        name: secret.name,
        error: 'Database error'
      });
    }
  }
  
  // Log import action
  audit.log('IMPORT_SECRETS', {
    orgId,
    targetType: 'organization',
    targetId: orgId,
    metadata: { 
      attempted: body.secrets.length,
      imported: imported.length,
      failed: errors.length
    },
  });
  
  return c.json({
    success: true,
    imported: imported.length,
    failed: errors.length,
    errors: errors.length > 0 ? errors : undefined,
  });
});
