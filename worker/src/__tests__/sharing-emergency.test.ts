import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { CIPHERTEXT, createOrgFixture, createTestContext, createUserWithToken, IV, secretBody } from './helpers/app';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function setupSecret() {
  const ctx = createTestContext();
  const fx = await createOrgFixture(ctx);
  const { body: secret } = await ctx.json('POST', `/api/organizations/${fx.orgId}/secrets`, { token: fx.admin.token, body: secretBody() });
  return { ctx, ...fx, secretId: secret.id as string };
}

function shareBody(overrides: Record<string, unknown> = {}) {
  return { id: crypto.randomUUID(), ciphertextBlob: CIPHERTEXT, iv: IV, expiresInHours: 24, maxViews: 2, ...overrides };
}

describe('share links', () => {
  it('serves the share ciphertext and enforces the view limit', async () => {
    const { ctx, orgId, member, secretId } = await setupSecret();
    const create = await ctx.json('POST', `/api/organizations/${orgId}/secrets/${secretId}/shares`, { token: member.token, body: shareBody() });
    expect(create.status).toBe(201);
    expect(create.body.url).toBe(`https://vault.example.org/share/${create.body.id}`);

    const info = await ctx.json('GET', `/api/share/${create.body.id}`);
    expect(info.body).toMatchObject({ secretName: 'Bank', requiresPassword: false, remainingViews: 2 });

    const v1 = await ctx.json('POST', `/api/share/${create.body.id}/access`, { body: {} });
    expect(v1.status).toBe(200);
    expect(v1.body.ciphertextBlob).toBe(CIPHERTEXT);
    expect((await ctx.json('POST', `/api/share/${create.body.id}/access`, { body: {} })).status).toBe(200);
    expect((await ctx.json('POST', `/api/share/${create.body.id}/access`, { body: {} })).status).toBe(410);

    expect(ctx.db.query("SELECT * FROM audit_logs WHERE action = 'ACCESS_SHARE_LINK'")).toHaveLength(2);
  });

  it('checks the client-derived password token without any server KDF', async () => {
    const { ctx, orgId, member, secretId } = await setupSecret();
    const token = 'ab'.repeat(32);
    const body = shareBody({ accessSalt: 'c2FsdA==', accessVerifier: sha256(token) });
    const { body: link } = await ctx.json('POST', `/api/organizations/${orgId}/secrets/${secretId}/shares`, { token: member.token, body });

    expect((await ctx.json('GET', `/api/share/${link.id}`)).body).toMatchObject({ requiresPassword: true, accessSalt: 'c2FsdA==' });
    expect((await ctx.json('POST', `/api/share/${link.id}/access`, { body: {} })).body.code).toBe('PASSWORD_REQUIRED');
    expect((await ctx.json('POST', `/api/share/${link.id}/access`, { body: { accessToken: 'cd'.repeat(32) } })).body.code).toBe('PASSWORD_INCORRECT');
    expect((await ctx.json('POST', `/api/share/${link.id}/access`, { body: { accessToken: token } })).status).toBe(200);
  });

  it('honours org settings, revocation and read-only restrictions', async () => {
    const { ctx, orgId, admin, member, reader, secretId } = await setupSecret();
    const path = `/api/organizations/${orgId}/secrets/${secretId}/shares`;

    expect((await ctx.json('POST', path, { token: reader.token, body: shareBody() })).status).toBe(403);
    await ctx.json('PUT', `/api/organizations/${orgId}/settings`, { token: admin.token, body: { shareLinkMaxHours: 12 } });
    expect((await ctx.json('POST', path, { token: member.token, body: shareBody() })).status).toBe(400);

    const { body: link } = await ctx.json('POST', path, { token: member.token, body: shareBody({ expiresInHours: 6 }) });
    expect((await ctx.json('DELETE', `/api/organizations/${orgId}/shares/${link.id}`, { token: member.token })).status).toBe(200);
    expect((await ctx.json('GET', `/api/share/${link.id}`)).status).toBe(410);
    expect(ctx.db.query('SELECT ciphertext_blob FROM share_links')[0].ciphertext_blob).toBeNull();

    await ctx.json('PUT', `/api/organizations/${orgId}/settings`, { token: admin.token, body: { allowShareLinks: false } });
    expect((await ctx.json('POST', path, { token: member.token, body: shareBody({ expiresInHours: 1 }) })).status).toBe(403);
  });
});

describe('emergency access', () => {
  it('escrows the org key and grants read-only access after the wait', async () => {
    const { ctx, orgId, admin } = await setupSecret();
    const contact = await createUserWithToken(ctx, 'trusted@example.org');

    const lookup = await ctx.json('GET', `/api/organizations/${orgId}/emergency-contacts/lookup?email=trusted@example.org`, { token: admin.token });
    expect(lookup.body.publicKey).toBeTruthy();

    const add = await ctx.json('POST', `/api/organizations/${orgId}/emergency-contacts`, {
      token: admin.token,
      body: { contactEmail: 'trusted@example.org', waitTimeHours: 48, encryptedOrgKey: 'ZXNjcm93' },
    });
    expect(add.status).toBe(201);

    const mine = await ctx.json('GET', '/api/emergency/access', { token: contact.token });
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].orgName).toBe('Test Org');

    const req = await ctx.json('POST', `/api/emergency/access/${add.body.id}/request`, { token: contact.token, body: { reason: 'The treasurer is unreachable' } });
    expect(req.status).toBe(201);
    expect((await ctx.json('POST', `/api/emergency/access/${add.body.id}/request`, { token: contact.token, body: { reason: 'Asking a second time' } })).status).toBe(409);

    const early = await ctx.json('POST', `/api/emergency/access/requests/${req.body.id}/claim`, { token: contact.token });
    expect(early.status).toBe(403);
    expect(early.body.code).toBe('WAITING_PERIOD');

    ctx.db.query("UPDATE emergency_requests SET grant_at = '2000-01-01 00:00:00'");
    const claim = await ctx.json('POST', `/api/emergency/access/requests/${req.body.id}/claim`, { token: contact.token });
    expect(claim.status).toBe(200);

    const orgs = await ctx.json('GET', '/api/organizations', { token: contact.token });
    expect(orgs.body.organizations[0]).toMatchObject({ id: orgId, role: 'read_only', encryptedOrgKey: 'ZXNjcm93' });
  });

  it('lets admins deny or approve early, and blocks non-admin setup', async () => {
    const { ctx, orgId, admin, member } = await setupSecret();
    const contact = await createUserWithToken(ctx, 'trusted@example.org');
    const body = { contactEmail: 'trusted@example.org', waitTimeHours: 48, encryptedOrgKey: 'ZXNjcm93' };

    expect((await ctx.json('POST', `/api/organizations/${orgId}/emergency-contacts`, { token: member.token, body })).status).toBe(403);
    const { body: added } = await ctx.json('POST', `/api/organizations/${orgId}/emergency-contacts`, { token: admin.token, body });

    const r1 = await ctx.json('POST', `/api/emergency/access/${added.id}/request`, { token: contact.token, body: { reason: 'First request here' } });
    expect((await ctx.json('POST', `/api/organizations/${orgId}/emergency-requests/${r1.body.id}/deny`, { token: admin.token })).status).toBe(200);
    expect((await ctx.json('POST', `/api/emergency/access/requests/${r1.body.id}/claim`, { token: contact.token })).status).toBe(409);

    const r2 = await ctx.json('POST', `/api/emergency/access/${added.id}/request`, { token: contact.token, body: { reason: 'Second request here' } });
    expect((await ctx.json('POST', `/api/organizations/${orgId}/emergency-requests/${r2.body.id}/approve`, { token: admin.token })).status).toBe(200);
    expect((await ctx.json('POST', `/api/emergency/access/requests/${r2.body.id}/claim`, { token: contact.token })).status).toBe(200);
  });

  it('refuses stale escrowed keys after a key rotation without them', async () => {
    const { ctx, orgId, admin } = await setupSecret();
    const contact = await createUserWithToken(ctx, 'trusted@example.org');
    const { body: added } = await ctx.json('POST', `/api/organizations/${orgId}/emergency-contacts`, {
      token: admin.token,
      body: { contactEmail: 'trusted@example.org', waitTimeHours: 24, encryptedOrgKey: 'ZXNjcm93' },
    });
    const r = await ctx.json('POST', `/api/emergency/access/${added.id}/request`, { token: contact.token, body: { reason: 'Need access please' } });
    ctx.db.query('UPDATE organizations SET key_version = 2');
    ctx.db.query("UPDATE emergency_requests SET grant_at = '2000-01-01 00:00:00'");
    expect((await ctx.json('POST', `/api/emergency/access/requests/${r.body.id}/claim`, { token: contact.token })).status).toBe(409);
  });
});
