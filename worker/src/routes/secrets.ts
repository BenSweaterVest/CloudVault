/**
 * Secrets: encrypted CRUD, per-user favorites, history, import and export.
 *
 * The server only ever sees ciphertext. Listing returns metadata only; the
 * ciphertext of a secret is fetched individually, which records a VIEW_SECRET
 * audit event. Bulk access (export) is audited too.
 *
 * Mounted on the authenticated org router at /api/organizations.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireMembership } from '../lib/access';
import { auditStatement, createAuditLogger } from '../middleware/audit';
import { getUser, HttpError, param } from '../lib/http';
import { chunkJson, parseJsonArray } from '../lib/db';
import {
  createSecretSchema,
  importSecretsSchema,
  toggleFavoriteSchema,
  updateSecretSchema,
  validateBody,
} from '../lib/validation';

export const secretsRoutes = new Hono<AppEnv>();

/** How many previous versions of a secret are kept. */
const HISTORY_LIMIT = 20;

interface SecretRow {
  id: string;
  org_id: string;
  name: string;
  url: string | null;
  username_hint: string | null;
  ciphertext_blob: string;
  iv: string;
  enc_version: number;
  version: number;
  created_by: string | null;
  updated_at: string;
  category_id: string | null;
  secret_type: string;
  expires_at: string | null;
  tags: string | null;
  is_favorite?: number;
  category_name?: string | null;
  category_color?: string | null;
}

function serializeMeta(s: SecretRow) {
  return {
    id: s.id,
    orgId: s.org_id,
    name: s.name,
    url: s.url,
    usernameHint: s.username_hint,
    version: s.version,
    createdBy: s.created_by,
    updatedAt: s.updated_at,
    categoryId: s.category_id,
    categoryName: s.category_name ?? null,
    categoryColor: s.category_color ?? null,
    isFavorite: s.is_favorite === 1,
    secretType: s.secret_type,
    expiresAt: s.expires_at,
    tags: parseJsonArray(s.tags),
  };
}

function serializeFull(s: SecretRow) {
  return { ...serializeMeta(s), ciphertextBlob: s.ciphertext_blob, iv: s.iv, encVersion: s.enc_version };
}

const SELECT_SECRET = `
  SELECT s.*, c.name AS category_name, c.color AS category_color,
         CASE WHEN f.secret_id IS NULL THEN 0 ELSE 1 END AS is_favorite
  FROM secrets s
  LEFT JOIN categories c ON c.id = s.category_id
  LEFT JOIN secret_favorites f ON f.secret_id = s.id AND f.user_id = ?
`;

async function loadSecret(db: D1Database, userId: string, orgId: string, secretId: string): Promise<SecretRow> {
  const secret = await db
    .prepare(`${SELECT_SECRET} WHERE s.id = ? AND s.org_id = ?`)
    .bind(userId, secretId, orgId)
    .first<SecretRow>();
  if (!secret) throw new HttpError(404, 'Secret not found');
  return secret;
}

async function assertCategoryInOrg(db: D1Database, orgId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const found = await db.prepare('SELECT 1 FROM categories WHERE id = ? AND org_id = ?').bind(categoryId, orgId).first();
  if (!found) throw new HttpError(400, 'Category not found in this organization');
}

// ============================================
// COLLECTION ROUTES (static paths before /:secretId)
// ============================================

/** List secret metadata (no ciphertext). */
secretsRoutes.get('/:orgId/secrets', async (c) => {
  const orgId = param(c, 'orgId');
  const user = getUser(c);
  await requireMembership(c, orgId);

  const categoryId = c.req.query('categoryId');
  const type = c.req.query('type');
  const favoritesOnly = c.req.query('favorites') === 'true';

  let sql = `${SELECT_SECRET} WHERE s.org_id = ?`;
  const params: string[] = [user.id, orgId];
  if (categoryId) {
    sql += ' AND s.category_id = ?';
    params.push(categoryId);
  }
  if (type) {
    sql += ' AND s.secret_type = ?';
    params.push(type);
  }
  if (favoritesOnly) sql += ' AND f.secret_id IS NOT NULL';
  sql += ' ORDER BY is_favorite DESC, s.name COLLATE NOCASE';

  const results = await c.env.DB.prepare(sql).bind(...params).all<SecretRow>();
  return c.json(results.results.map(serializeMeta));
});

/** Secrets expiring within 30 days (or already expired). */
secretsRoutes.get('/:orgId/secrets/expiring', async (c) => {
  const orgId = param(c, 'orgId');
  const user = getUser(c);
  await requireMembership(c, orgId);
  const results = await c.env.DB.prepare(
    `${SELECT_SECRET} WHERE s.org_id = ? AND s.expires_at IS NOT NULL AND s.expires_at <= ? ORDER BY s.expires_at`
  )
    .bind(user.id, orgId, new Date(Date.now() + 30 * 86_400_000).toISOString())
    .all<SecretRow>();
  return c.json(results.results.map(serializeMeta));
});

/** Encrypted export of every secret. Decryption happens in the browser. */
secretsRoutes.get('/:orgId/secrets/export', async (c) => {
  const orgId = param(c, 'orgId');
  const user = getUser(c);
  await requireMembership(c, orgId);

  const results = await c.env.DB.prepare(`${SELECT_SECRET} WHERE s.org_id = ? ORDER BY s.name COLLATE NOCASE`)
    .bind(user.id, orgId)
    .all<SecretRow>();

  createAuditLogger(c).log('EXPORT_SECRETS', {
    orgId,
    targetType: 'organization',
    targetId: orgId,
    metadata: { count: results.results.length },
  });

  return c.json({
    version: '2.0',
    exportedAt: new Date().toISOString(),
    orgId,
    secrets: results.results.map(serializeFull),
  });
});

/**
 * Import already-encrypted secrets in one statement (json_each), so a 500
 * secret import stays within the free plan's per-request query limit.
 */
secretsRoutes.post('/:orgId/secrets/import', async (c) => {
  const orgId = param(c, 'orgId');
  const user = getUser(c);
  await requireMembership(c, orgId, 'member');
  const { secrets, categoryId } = await validateBody(c, importSecretsSchema);
  await assertCategoryInOrg(c.env.DB, orgId, categoryId);

  for (const s of secrets) {
    if (s.encVersion === 2 && !s.id) throw new HttpError(400, 'Secrets encrypted with format 2 must include their id');
    if (s.categoryId && s.categoryId !== categoryId) await assertCategoryInOrg(c.env.DB, orgId, s.categoryId);
  }

  const rows = secrets.map((s) => ({
    id: s.id ?? crypto.randomUUID(),
    name: s.name,
    url: s.url || null,
    hint: s.usernameHint || null,
    c: s.ciphertextBlob,
    iv: s.iv,
    v: s.encVersion,
    cat: s.categoryId ?? categoryId ?? null,
    type: s.secretType,
    tags: s.tags ? JSON.stringify(s.tags) : null,
    exp: s.expiresAt ?? null,
  }));

  const audit = createAuditLogger(c);
  const statements = chunkJson(rows).map((chunk) =>
    c.env.DB.prepare(
      `INSERT INTO secrets (id, org_id, name, url, username_hint, ciphertext_blob, iv, enc_version, version,
                            created_by, category_id, secret_type, tags, expires_at)
       SELECT json_extract(value, '$.id'), ?2, json_extract(value, '$.name'), json_extract(value, '$.url'),
              json_extract(value, '$.hint'), json_extract(value, '$.c'), json_extract(value, '$.iv'),
              json_extract(value, '$.v'), 1, ?3, json_extract(value, '$.cat'), json_extract(value, '$.type'),
              json_extract(value, '$.tags'), json_extract(value, '$.exp')
       FROM json_each(?1)`
    ).bind(chunk, orgId, user.id)
  );
  statements.push(
    auditStatement(
      c.env.DB,
      audit.entry('IMPORT_SECRETS', { orgId, targetType: 'organization', targetId: orgId, metadata: { imported: rows.length } })
    )
  );

  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    if (err instanceof Error && /UNIQUE|PRIMARY KEY/i.test(err.message)) {
      throw new HttpError(409, 'One or more secret ids already exist');
    }
    throw err;
  }

  return c.json({ success: true, imported: rows.length, ids: rows.map((r) => r.id) }, 201);
});

/** Create a secret. */
secretsRoutes.post('/:orgId/secrets', async (c) => {
  const orgId = param(c, 'orgId');
  const user = getUser(c);
  await requireMembership(c, orgId, 'member');
  const data = await validateBody(c, createSecretSchema);

  if (data.encVersion === 2 && !data.id) throw new HttpError(400, 'Secrets encrypted with format 2 must include their id');
  await assertCategoryInOrg(c.env.DB, orgId, data.categoryId);

  const secretId = data.id ?? crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      `INSERT INTO secrets (id, org_id, name, url, username_hint, ciphertext_blob, iv, enc_version,
                            created_by, category_id, secret_type, tags, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        secretId,
        orgId,
        data.name,
        data.url || null,
        data.usernameHint || null,
        data.ciphertextBlob,
        data.iv,
        data.encVersion,
        user.id,
        data.categoryId ?? null,
        data.secretType,
        data.tags ? JSON.stringify(data.tags) : null,
        data.expiresAt ?? null
      )
      .run();
  } catch (err) {
    if (err instanceof Error && /UNIQUE|PRIMARY KEY/i.test(err.message)) {
      throw new HttpError(409, 'A secret with this id already exists');
    }
    throw err;
  }

  createAuditLogger(c).log('CREATE_SECRET', {
    orgId,
    targetType: 'secret',
    targetId: secretId,
    targetName: data.name,
    metadata: { secretType: data.secretType },
  });

  return c.json(serializeFull(await loadSecret(c.env.DB, user.id, orgId, secretId)), 201);
});

// ============================================
// SINGLE SECRET ROUTES
// ============================================

/** Fetch one secret including ciphertext. Audited as a view. */
secretsRoutes.get('/:orgId/secrets/:secretId', async (c) => {
  const orgId = param(c, 'orgId');
  const secretId = param(c, 'secretId');
  const user = getUser(c);
  await requireMembership(c, orgId);

  const secret = await loadSecret(c.env.DB, user.id, orgId, secretId);
  createAuditLogger(c).log('VIEW_SECRET', { orgId, targetType: 'secret', targetId: secretId, targetName: secret.name });
  return c.json(serializeFull(secret));
});

/**
 * Update a secret. When the ciphertext changes, the previous version is
 * saved to history (keeping the newest HISTORY_LIMIT versions). If the client
 * sends expectedVersion and someone else saved first, returns 409.
 */
secretsRoutes.put('/:orgId/secrets/:secretId', async (c) => {
  const orgId = param(c, 'orgId');
  const secretId = param(c, 'secretId');
  const user = getUser(c);
  await requireMembership(c, orgId, 'member');
  const data = await validateBody(c, updateSecretSchema);
  const db = c.env.DB;

  const current = await loadSecret(db, user.id, orgId, secretId);
  if (data.expectedVersion !== undefined && data.expectedVersion !== current.version) {
    throw new HttpError(409, 'This secret was changed by someone else. Reload it and try again.', 'VERSION_CONFLICT');
  }
  if (data.categoryId !== undefined) await assertCategoryInOrg(db, orgId, data.categoryId);

  const ciphertextChanged = data.ciphertextBlob !== undefined && data.ciphertextBlob !== current.ciphertext_blob;

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (column: string, value: string | number | null) => {
    updates.push(`${column} = ?`);
    values.push(value);
  };

  if (data.name !== undefined) set('name', data.name);
  if (data.url !== undefined) set('url', data.url || null);
  if (data.usernameHint !== undefined) set('username_hint', data.usernameHint || null);
  if (data.categoryId !== undefined) set('category_id', data.categoryId);
  if (data.secretType !== undefined) set('secret_type', data.secretType);
  if (data.tags !== undefined) set('tags', JSON.stringify(data.tags));
  if (data.expiresAt !== undefined) set('expires_at', data.expiresAt);
  if (ciphertextChanged && data.ciphertextBlob && data.iv) {
    set('ciphertext_blob', data.ciphertextBlob);
    set('iv', data.iv);
    set('enc_version', data.encVersion ?? current.enc_version);
    updates.push('version = version + 1');
  }
  updates.push('updated_at = CURRENT_TIMESTAMP');

  const statements: D1PreparedStatement[] = [];
  if (ciphertextChanged) {
    statements.push(
      db
        .prepare('INSERT INTO secret_history (secret_id, version, ciphertext_blob, iv, enc_version, changed_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(secretId, current.version, current.ciphertext_blob, current.iv, current.enc_version, user.id),
      db
        .prepare(
          `DELETE FROM secret_history WHERE secret_id = ?1 AND id NOT IN
             (SELECT id FROM secret_history WHERE secret_id = ?1 ORDER BY version DESC LIMIT ?2)`
        )
        .bind(secretId, HISTORY_LIMIT)
    );
  }
  statements.push(
    db
      .prepare(`UPDATE secrets SET ${updates.join(', ')} WHERE id = ? AND org_id = ? AND version = ?`)
      .bind(...values, secretId, orgId, current.version)
  );

  const results = await db.batch(statements);
  const updateResult = results[results.length - 1];
  if (!updateResult.meta?.changes) {
    throw new HttpError(409, 'This secret was changed by someone else. Reload it and try again.', 'VERSION_CONFLICT');
  }

  const updated = await loadSecret(db, user.id, orgId, secretId);
  createAuditLogger(c).log('UPDATE_SECRET', {
    orgId,
    targetType: 'secret',
    targetId: secretId,
    targetName: updated.name,
    metadata: { ciphertextChanged },
  });
  return c.json(serializeFull(updated));
});

/** Toggle the current user's favorite flag. Any member, including read-only. */
secretsRoutes.patch('/:orgId/secrets/:secretId/favorite', async (c) => {
  const orgId = param(c, 'orgId');
  const secretId = param(c, 'secretId');
  const user = getUser(c);
  await requireMembership(c, orgId);
  const { isFavorite } = await validateBody(c, toggleFavoriteSchema);

  const exists = await c.env.DB.prepare('SELECT 1 FROM secrets WHERE id = ? AND org_id = ?').bind(secretId, orgId).first();
  if (!exists) throw new HttpError(404, 'Secret not found');

  await c.env.DB.prepare(
    isFavorite
      ? 'INSERT OR IGNORE INTO secret_favorites (user_id, secret_id) VALUES (?, ?)'
      : 'DELETE FROM secret_favorites WHERE user_id = ? AND secret_id = ?'
  )
    .bind(user.id, secretId)
    .run();

  return c.json({ success: true, isFavorite });
});

secretsRoutes.delete('/:orgId/secrets/:secretId', async (c) => {
  const orgId = param(c, 'orgId');
  const secretId = param(c, 'secretId');
  await requireMembership(c, orgId, 'member');
  const db = c.env.DB;

  const secret = await db.prepare('SELECT name FROM secrets WHERE id = ? AND org_id = ?').bind(secretId, orgId).first<{ name: string }>();
  if (!secret) throw new HttpError(404, 'Secret not found');

  const audit = createAuditLogger(c);
  await db.batch([
    db.prepare('DELETE FROM share_links WHERE secret_id = ?').bind(secretId),
    db.prepare('DELETE FROM secret_favorites WHERE secret_id = ?').bind(secretId),
    db.prepare('DELETE FROM secret_history WHERE secret_id = ?').bind(secretId),
    db.prepare('DELETE FROM secrets WHERE id = ? AND org_id = ?').bind(secretId, orgId),
    auditStatement(db, audit.entry('DELETE_SECRET', { orgId, targetType: 'secret', targetId: secretId, targetName: secret.name })),
  ]);
  return c.json({ success: true });
});

/** Previous versions (ciphertext). Audited. */
secretsRoutes.get('/:orgId/secrets/:secretId/history', async (c) => {
  const orgId = param(c, 'orgId');
  const secretId = param(c, 'secretId');
  await requireMembership(c, orgId);

  const secret = await c.env.DB.prepare('SELECT name FROM secrets WHERE id = ? AND org_id = ?')
    .bind(secretId, orgId)
    .first<{ name: string }>();
  if (!secret) throw new HttpError(404, 'Secret not found');

  const results = await c.env.DB.prepare(
    `SELECT h.id, h.secret_id, h.version, h.ciphertext_blob, h.iv, h.enc_version, h.changed_by, h.created_at,
            u.email AS changed_by_email
     FROM secret_history h LEFT JOIN users u ON h.changed_by = u.id
     WHERE h.secret_id = ? ORDER BY h.version DESC`
  )
    .bind(secretId)
    .all<{
      id: number;
      secret_id: string;
      version: number;
      ciphertext_blob: string;
      iv: string;
      enc_version: number;
      changed_by: string | null;
      created_at: string;
      changed_by_email: string | null;
    }>();

  createAuditLogger(c).log('VIEW_SECRET_HISTORY', { orgId, targetType: 'secret', targetId: secretId, targetName: secret.name });

  return c.json(
    results.results.map((h) => ({
      id: h.id,
      secretId: h.secret_id,
      version: h.version,
      ciphertextBlob: h.ciphertext_blob,
      iv: h.iv,
      encVersion: h.enc_version,
      changedBy: h.changed_by,
      changedByEmail: h.changed_by_email,
      createdAt: h.created_at,
    }))
  );
});
