import { describe, expect, it } from 'vitest';
import { CIPHERTEXT, createOrgFixture, createTestContext, IV, secretBody } from './helpers/app';

describe('secrets', () => {
  it('lists metadata only and audits individual views', async () => {
    const ctx = createTestContext();
    const { orgId, admin, member } = await createOrgFixture(ctx);
    const created = await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody({ tags: ['bank'] }) });
    expect(created.status).toBe(201);
    expect(created.body.encVersion).toBe(2);

    const list = await ctx.json('GET', `/api/organizations/${orgId}/secrets`, { token: member.token });
    expect(list.body).toHaveLength(1);
    expect(list.body[0].ciphertextBlob).toBeUndefined();
    expect(list.body[0].tags).toEqual(['bank']);

    const view = await ctx.json('GET', `/api/organizations/${orgId}/secrets/${created.body.id}`, { token: member.token });
    expect(view.body.ciphertextBlob).toBe(CIPHERTEXT);
    const views = ctx.db.query("SELECT user_email FROM audit_logs WHERE action = 'VIEW_SECRET'");
    expect(views).toEqual([{ user_email: 'member@example.org' }]);
  });

  it('requires a client id for format 2 and rejects duplicate ids', async () => {
    const ctx = createTestContext();
    const { orgId, admin } = await createOrgFixture(ctx);
    const noId = await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody({ id: undefined }) });
    expect(noId.status).toBe(400);

    const body = secretBody();
    expect((await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body })).status).toBe(201);
    expect((await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body })).status).toBe(409);
  });

  it('rejects javascript: URLs, malformed IVs and categories from other orgs', async () => {
    const ctx = createTestContext();
    const { orgId, admin } = await createOrgFixture(ctx);
    const other = await ctx.json('POST', '/api/organizations', { token: admin.token, body: { name: 'Other', encryptedOrgKey: 'a2V5' } });
    const cat = await ctx.json('POST', `/api/organizations/${other.body.id}/categories`, { token: admin.token, body: { name: 'Elsewhere' } });

    const cases = [{ url: 'javascript:alert(1)' }, { iv: 'xyz' }, { categoryId: cat.body.id }];
    for (const override of cases) {
      const res = await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody(override) });
      expect(res.status, JSON.stringify(override)).toBe(400);
    }
  });

  it('keeps history, prevents lost updates and prunes old versions', async () => {
    const ctx = createTestContext();
    const { orgId, admin, member } = await createOrgFixture(ctx);
    const { body: secret } = await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody() });
    const path = `/api/organizations/${orgId}/secrets/${secret.id}`;

    const first = await ctx.json('PUT', path, { token: admin.token, body: { ciphertextBlob: 'ab'.repeat(16), iv: IV, expectedVersion: 1 } });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(2);

    const stale = await ctx.json('PUT', path, { token: member.token, body: { ciphertextBlob: 'cd'.repeat(16), iv: IV, expectedVersion: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');

    const rename = await ctx.json('PUT', path, { token: member.token, body: { name: 'Renamed' } });
    expect(rename.body.version).toBe(2);

    const halfCipher = await ctx.json('PUT', path, { token: member.token, body: { ciphertextBlob: 'ef'.repeat(16) } });
    expect(halfCipher.status).toBe(400);

    for (let i = 0; i < 25; i++) {
      await ctx.json('PUT', path, { token: admin.token, body: { ciphertextBlob: (i + 16).toString(16).padStart(2, '0').repeat(16), iv: IV } });
    }
    const history = await ctx.json('GET', `${path}/history`, { token: member.token });
    expect(history.body).toHaveLength(20);
    expect(history.body[0].version).toBeGreaterThan(history.body[19].version);
  });

  it('serves export and expiring routes (not shadowed by /:secretId)', async () => {
    const ctx = createTestContext();
    const { orgId, admin } = await createOrgFixture(ctx);
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody({ expiresAt: soon }) });
    await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody({ name: 'Later' }) });

    const exp = await ctx.json('GET', `/api/organizations/${orgId}/secrets/export`, { token: admin.token });
    expect(exp.status).toBe(200);
    expect(exp.body.secrets).toHaveLength(2);
    expect(ctx.db.query("SELECT * FROM audit_logs WHERE action = 'EXPORT_SECRETS'")).toHaveLength(1);

    const expiring = await ctx.json('GET', `/api/organizations/${orgId}/secrets/expiring`, { token: admin.token });
    expect(expiring.status).toBe(200);
    expect(expiring.body.map((s: { name: string }) => s.name)).toEqual(['Bank']);
  });

  it('imports many secrets in one statement', async () => {
    const ctx = createTestContext();
    const { orgId, member } = await createOrgFixture(ctx);
    const secrets = Array.from({ length: 300 }, (_, i) => secretBody({ name: `Imported ${i}`, url: 'https://example.org' }));
    const res = await ctx.json('POST', `/api/organizations/${orgId}/secrets/import`, { token: member.token, body: { secrets } });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(300);
    expect(ctx.db.query('SELECT COUNT(*) AS n FROM secrets')[0].n).toBe(300);

    const again = await ctx.json('POST', `/api/organizations/${orgId}/secrets/import`, { token: member.token, body: { secrets: secrets.slice(0, 1) } });
    expect(again.status).toBe(409);
  });

  it('keeps favorites per user', async () => {
    const ctx = createTestContext();
    const { orgId, admin, reader } = await createOrgFixture(ctx);
    const { body: s } = await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody() });

    const fav = await ctx.json('PATCH', `/api/organizations/${orgId}/secrets/${s.id}/favorite`, { token: reader.token, body: { isFavorite: true } });
    expect(fav.status).toBe(200);

    const forReader = await ctx.json('GET', `/api/organizations/${orgId}/secrets`, { token: reader.token });
    const forAdmin = await ctx.json('GET', `/api/organizations/${orgId}/secrets`, { token: admin.token });
    expect(forReader.body[0].isFavorite).toBe(true);
    expect(forAdmin.body[0].isFavorite).toBe(false);
  });

  it('deletes a secret with its history, favorites and share links', async () => {
    const ctx = createTestContext();
    const { orgId, admin } = await createOrgFixture(ctx);
    const { body: s } = await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody() });
    await ctx.json('PUT', `/api/organizations/${orgId}/secrets/${s.id}`, { token: admin.token, body: { ciphertextBlob: 'ab'.repeat(8), iv: IV } });
    await ctx.json('PATCH', `/api/organizations/${orgId}/secrets/${s.id}/favorite`, { token: admin.token, body: { isFavorite: true } });

    expect((await ctx.json('DELETE', `/api/organizations/${orgId}/secrets/${s.id}`, { token: admin.token })).status).toBe(200);
    for (const table of ['secrets', 'secret_history', 'secret_favorites']) {
      expect(ctx.db.query(`SELECT * FROM ${table}`), table).toHaveLength(0);
    }
  });
});

describe('categories', () => {
  it('creates, orders, updates and deletes (admin only), unlinking secrets', async () => {
    const ctx = createTestContext();
    const { orgId, admin, member } = await createOrgFixture(ctx);
    const a = await ctx.json('POST', `/api/organizations/${orgId}/categories`, { token: member.token, body: { name: 'A' } });
    const b = await ctx.json('POST', `/api/organizations/${orgId}/categories`, { token: member.token, body: { name: 'B', color: '#ff0000' } });
    expect([a.body.sortOrder, b.body.sortOrder]).toEqual([0, 1]);

    await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody({ categoryId: a.body.id }) });
    const list = await ctx.json('GET', `/api/organizations/${orgId}/categories`, { token: member.token });
    expect(list.body[0].secretCount).toBe(1);

    expect((await ctx.json('DELETE', `/api/organizations/${orgId}/categories/${a.body.id}`, { token: member.token })).status).toBe(403);
    expect((await ctx.json('DELETE', `/api/organizations/${orgId}/categories/${a.body.id}`, { token: admin.token })).status).toBe(200);
    expect(ctx.db.query('SELECT category_id FROM secrets')[0].category_id).toBeNull();
  });
});
