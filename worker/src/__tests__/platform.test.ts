import { describe, expect, it } from 'vitest';
import { createOrgFixture, createTestContext, secretBody } from './helpers/app';
import { csvCell } from '../routes/audit';
import { getCorsOrigin } from '../middleware/security';
import { runMaintenance } from '../scheduled';
import { validateEnv } from '../index';
import { chunkJson } from '../lib/db';
import { hitCounter } from '../middleware/rateLimit';

describe('audit log', () => {
  it('filters by action and exports formula-safe CSV', async () => {
    const ctx = createTestContext();
    const { orgId, admin } = await createOrgFixture(ctx);
    await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody({ name: '=HYPERLINK("http://evil")' }) });

    const filtered = await ctx.json('GET', `/api/organizations/${orgId}/audit?action=CREATE_SECRET`, { token: admin.token });
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBe(1);

    expect((await ctx.json('GET', `/api/organizations/${orgId}/audit?action=NOT_REAL`, { token: admin.token })).status).toBe(400);

    const csv = await (await ctx.request('GET', `/api/organizations/${orgId}/audit/export`, { token: admin.token })).text();
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('escapes CSV cells', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('-1+1')).toBe(`"'-1+1"`);
    expect(csvCell(null)).toBe('""');
  });
});

describe('settings and health', () => {
  it('reads defaults, validates and updates settings (admin only)', async () => {
    const ctx = createTestContext();
    const { orgId, admin, member } = await createOrgFixture(ctx);
    const get = await ctx.json('GET', `/api/organizations/${orgId}/settings`, { token: member.token });
    expect(get.body.minPasswordLength).toBe(12);

    expect((await ctx.json('PUT', `/api/organizations/${orgId}/settings`, { token: member.token, body: { minPasswordLength: 20 } })).status).toBe(403);
    expect((await ctx.json('PUT', `/api/organizations/${orgId}/settings`, { token: admin.token, body: { minPasswordLength: 4 } })).status).toBe(400);
    const put = await ctx.json('PUT', `/api/organizations/${orgId}/settings`, { token: admin.token, body: { minPasswordLength: 20, allowShareLinks: false } });
    expect(put.body).toMatchObject({ minPasswordLength: 20, allowShareLinks: false });
  });

  it('computes a health report', async () => {
    const ctx = createTestContext();
    const { orgId, admin } = await createOrgFixture(ctx);
    await ctx.json('POST', `/api/organizations/${orgId}/secrets`, {
      token: admin.token,
      body: secretBody({ expiresAt: new Date(Date.now() - 86_400_000).toISOString() }),
    });
    const res = await ctx.json('GET', `/api/organizations/${orgId}/health`, { token: admin.token });
    expect(res.body.metrics.expired).toBe(1);
    expect(res.body.healthScore).toBeLessThan(100);
  });
});

describe('maintenance job', () => {
  it('removes expired data and applies audit retention', async () => {
    const ctx = createTestContext();
    const { orgId } = await createOrgFixture(ctx);
    ctx.db.query("INSERT INTO rate_limits (key, count, expires_at) VALUES ('old', 1, 1)");
    ctx.db.query("INSERT INTO magic_links (token, email, expires_at) VALUES ('t', 'a@b.c', '2000-01-01T00:00:00.000Z')");
    ctx.db.query("INSERT INTO audit_logs (org_id, action, timestamp) VALUES (?, 'LOGIN', '2000-01-01 00:00:00')", orgId);
    ctx.db.query("INSERT INTO audit_logs (org_id, action) VALUES (?, 'LOGIN')", orgId);

    const counts = await runMaintenance(ctx.env);
    expect(counts.rateLimits).toBe(1);
    expect(counts.magicLinks).toBe(1);
    expect(counts.audit).toBe(1);
    expect(ctx.db.query("SELECT * FROM audit_logs WHERE action = 'LOGIN'")).toHaveLength(1);
  });
});

describe('platform', () => {
  it('only allows the configured origin (and real localhost in dev)', () => {
    expect(getCorsOrigin('https://vault.example.org', 'https://vault.example.org/')).toBe('https://vault.example.org');
    expect(getCorsOrigin('https://evil.example', 'https://vault.example.org')).toBeNull();
    expect(getCorsOrigin('http://localhost:3000', 'http://localhost:5173')).toBe('http://localhost:3000');
    expect(getCorsOrigin('http://localhost.evil.com', 'http://localhost:5173')).toBeNull();
    expect(getCorsOrigin('http://localhost:3000', 'https://vault.example.org')).toBeNull();
  });

  it('reports configuration problems', () => {
    expect(validateEnv({ APP_URL: 'nope', JWT_SECRET: 'short' } as never)).toEqual(
      expect.arrayContaining([
        'Missing required setting: DB',
        'JWT_SECRET must be at least 32 characters',
        'APP_URL must be a valid URL, for example https://vault.example.org',
      ])
    );
  });

  it('chunks JSON parameters under the size limit', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ i, pad: 'x'.repeat(100) }));
    const chunks = chunkJson(rows, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((c) => JSON.parse(c))).toEqual(rows);
    expect(chunkJson([])).toEqual([]);
  });

  it('counts rate limit hits atomically per window', async () => {
    const ctx = createTestContext();
    const a = await hitCounter(ctx.env.DB, 'k', 60);
    const b = await hitCounter(ctx.env.DB, 'k', 60);
    expect([a.count, b.count]).toEqual([1, 2]);
  });

  it('rate limits public share access per IP', async () => {
    const ctx = createTestContext();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await ctx.request('GET', `/api/share/${crypto.randomUUID()}`)).status;
    expect(last).toBe(429);
  });

  it('sets security headers and returns JSON 404s', async () => {
    const ctx = createTestContext();
    const res = await ctx.request('GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
