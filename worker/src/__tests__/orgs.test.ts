import { describe, expect, it } from 'vitest';
import { createOrgFixture, createTestContext, createUserWithToken, FAKE_ENCRYPTED_KEY, IV, secretBody } from './helpers/app';

describe('organizations', () => {
  it('lists active orgs and pending invites separately', async () => {
    const ctx = createTestContext();
    const { orgId, admin } = await createOrgFixture(ctx);
    const invitee = await createUserWithToken(ctx, 'new@example.org');

    await ctx.json('POST', `/api/organizations/${orgId}/members`, { token: admin.token, body: { email: 'new@example.org' } });
    const res = await ctx.json('GET', '/api/organizations', { token: invitee.token });
    expect(res.body.organizations).toHaveLength(0);
    expect(res.body.pendingInvites).toEqual([{ id: orgId, name: 'Test Org' }]);
  });

  it('blocks non-members and enforces roles', async () => {
    const ctx = createTestContext();
    const { orgId, member, reader, outsider } = await createOrgFixture(ctx);
    expect((await ctx.request('GET', `/api/organizations/${orgId}/secrets`, { token: outsider.token })).status).toBe(403);
    expect((await ctx.request('POST', `/api/organizations/${orgId}/secrets`, { token: reader.token, body: secretBody() })).status).toBe(403);
    expect((await ctx.request('POST', `/api/organizations/${orgId}/secrets`, { token: member.token, body: secretBody() })).status).toBe(201);
    expect((await ctx.request('GET', `/api/organizations/${orgId}/audit`, { token: member.token })).status).toBe(403);
  });

  it('renames and deletes atomically, keeping the audit record', async () => {
    const ctx = createTestContext();
    const { orgId, admin } = await createOrgFixture(ctx);
    await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody() });

    expect((await ctx.json('PATCH', `/api/organizations/${orgId}`, { token: admin.token, body: { name: 'Renamed' } })).status).toBe(200);
    const del = await ctx.json('DELETE', `/api/organizations/${orgId}`, { token: admin.token });
    expect(del.status).toBe(200);
    expect(del.body.deleted).toEqual({ members: 3, secrets: 1 });
    expect(ctx.db.query('SELECT * FROM secrets')).toHaveLength(0);
    expect(ctx.db.query("SELECT * FROM audit_logs WHERE action = 'DELETE_ORG'")).toHaveLength(1);
  });
});

describe('members', () => {
  it('invites with a role and only approves users who have keys', async () => {
    const ctx = createTestContext();
    const { orgId, admin } = await createOrgFixture(ctx);

    const invite = await ctx.json('POST', `/api/organizations/${orgId}/members`, {
      token: admin.token,
      body: { email: 'Reader2@Example.org', role: 'read_only' },
    });
    expect(invite.status).toBe(201);
    expect(invite.body.role).toBe('read_only');
    expect(invite.body.hasKeys).toBe(false);

    const dup = await ctx.json('POST', `/api/organizations/${orgId}/members`, { token: admin.token, body: { email: 'reader2@example.org' } });
    expect(dup.status).toBe(409);

    const approveEarly = await ctx.json('POST', `/api/organizations/${orgId}/members/${invite.body.userId}/approve`, {
      token: admin.token,
      body: { encryptedOrgKey: FAKE_ENCRYPTED_KEY },
    });
    expect(approveEarly.status).toBe(409);

    ctx.db.query("UPDATE users SET public_key = 'cHVi' WHERE id = ?", invite.body.userId);
    const approve = await ctx.json('POST', `/api/organizations/${orgId}/members/${invite.body.userId}/approve`, {
      token: admin.token,
      body: { encryptedOrgKey: FAKE_ENCRYPTED_KEY },
    });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('active');
    expect(approve.body.role).toBe('read_only');
  });

  it('rejects invalid roles and protects the last admin', async () => {
    const ctx = createTestContext();
    const { orgId, admin, member } = await createOrgFixture(ctx);

    const bad = await ctx.json('PATCH', `/api/organizations/${orgId}/members/${member.id}`, { token: admin.token, body: { role: 'owner' } });
    expect(bad.status).toBe(400);

    const self = await ctx.json('PATCH', `/api/organizations/${orgId}/members/${admin.id}`, { token: admin.token, body: { role: 'member' } });
    expect(self.status).toBe(400);

    const leave = await ctx.json('POST', `/api/organizations/${orgId}/leave`, { token: admin.token });
    expect(leave.status).toBe(400);

    await ctx.json('PATCH', `/api/organizations/${orgId}/members/${member.id}`, { token: admin.token, body: { role: 'admin' } });
    expect((await ctx.json('POST', `/api/organizations/${orgId}/leave`, { token: admin.token })).status).toBe(200);
    expect((await ctx.request('GET', `/api/organizations/${orgId}`, { token: admin.token })).status).toBe(403);
  });

  it('removes a member, cleans up their favorites and recommends key rotation', async () => {
    const ctx = createTestContext();
    const { orgId, admin, member } = await createOrgFixture(ctx);
    const secret = await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody() });
    await ctx.json('PATCH', `/api/organizations/${orgId}/secrets/${secret.body.id}/favorite`, { token: member.token, body: { isFavorite: true } });

    const res = await ctx.json('DELETE', `/api/organizations/${orgId}/members/${member.id}`, { token: admin.token });
    expect(res.status).toBe(200);
    expect(res.body.recommendKeyRotation).toBe(true);
    expect(ctx.db.query('SELECT * FROM secret_favorites WHERE user_id = ?', member.id)).toHaveLength(0);
    expect((await ctx.request('GET', `/api/organizations/${orgId}/secrets`, { token: member.token })).status).toBe(403);
  });

  it('hides pending members from non-admins', async () => {
    const ctx = createTestContext();
    const { orgId, admin, member } = await createOrgFixture(ctx);
    await ctx.json('POST', `/api/organizations/${orgId}/members`, { token: admin.token, body: { email: 'p@example.org' } });
    const asAdmin = await ctx.json('GET', `/api/organizations/${orgId}/members`, { token: admin.token });
    const asMember = await ctx.json('GET', `/api/organizations/${orgId}/members`, { token: member.token });
    expect(asAdmin.body).toHaveLength(4);
    expect(asMember.body).toHaveLength(3);
  });
});

describe('org key rotation', () => {
  it('returns everything needed, then commits atomically', async () => {
    const ctx = createTestContext();
    const { orgId, admin, member, reader } = await createOrgFixture(ctx);
    const s = await ctx.json('POST', `/api/organizations/${orgId}/secrets`, { token: admin.token, body: secretBody() });
    await ctx.json('PUT', `/api/organizations/${orgId}/secrets/${s.body.id}`, { token: admin.token, body: { ciphertextBlob: 'ab'.repeat(20), iv: IV } });

    const data = await ctx.json('GET', `/api/organizations/${orgId}/key-rotation`, { token: admin.token });
    expect(data.status).toBe(200);
    expect(data.body.keyVersion).toBe(1);
    expect(data.body.secrets).toHaveLength(1);
    expect(data.body.history).toHaveLength(1);
    expect(data.body.members).toHaveLength(3);

    const newCipher = 'cd'.repeat(20);
    const body = {
      fromKeyVersion: 1,
      secrets: [{ id: s.body.id, ciphertextBlob: newCipher, iv: IV, encVersion: 2 }],
      history: [{ id: data.body.history[0].id, ciphertextBlob: newCipher, iv: IV, encVersion: 2 }],
      memberKeys: [admin, member, reader].map((u) => ({ userId: u.id, encryptedOrgKey: 'bmV3a2V5' })),
    };

    const missingMember = await ctx.json('POST', `/api/organizations/${orgId}/key-rotation`, {
      token: admin.token,
      body: { ...body, memberKeys: body.memberKeys.slice(0, 2) },
    });
    expect(missingMember.status).toBe(409);

    const ok = await ctx.json('POST', `/api/organizations/${orgId}/key-rotation`, { token: admin.token, body });
    expect(ok.status).toBe(200);
    expect(ok.body.keyVersion).toBe(2);
    expect(ctx.db.query('SELECT ciphertext_blob FROM secrets')[0].ciphertext_blob).toBe(newCipher);
    expect(ctx.db.query('SELECT ciphertext_blob FROM secret_history')[0].ciphertext_blob).toBe(newCipher);
    expect(ctx.db.query('SELECT DISTINCT encrypted_org_key AS k FROM memberships WHERE org_id = ?', orgId)).toEqual([{ k: 'bmV3a2V5' }]);

    const stale = await ctx.json('POST', `/api/organizations/${orgId}/key-rotation`, { token: admin.token, body });
    expect(stale.status).toBe(409);
  });

  it('is admin only', async () => {
    const ctx = createTestContext();
    const { orgId, member } = await createOrgFixture(ctx);
    expect((await ctx.request('GET', `/api/organizations/${orgId}/key-rotation`, { token: member.token })).status).toBe(403);
  });
});

