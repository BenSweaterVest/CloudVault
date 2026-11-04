import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestContext, createToken, createUser } from './helpers/app';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stub fetch for Resend and capture the magic link token from the email. */
function captureEmails() {
  const sent: Array<{ to: unknown; subject: string; html: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('api.resend.com')) {
        sent.push(JSON.parse(String(init?.body)));
        return new Response('{}', { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    })
  );
  return {
    sent,
    lastToken: () => {
      const match = sent[sent.length - 1]?.html.match(/#token=([A-Za-z0-9_-]+)/);
      return match?.[1];
    },
  };
}

function stubGitHub(options: { id?: number; emails?: Array<{ email: string; primary: boolean; verified: boolean }> }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('login/oauth/access_token')) return Response.json({ access_token: 'gh-token' });
      if (u.endsWith('/user')) return Response.json({ id: options.id ?? 42, login: 'octo', name: 'Octo Cat' });
      if (u.endsWith('/user/emails')) return Response.json(options.emails ?? []);
      throw new Error(`Unexpected fetch: ${u}`);
    })
  );
}

describe('magic links', () => {
  it('logs in once with a valid link and never stores the raw token', async () => {
    const ctx = createTestContext({ RESEND_API_KEY: 're_test' });
    const mail = captureEmails();

    const req = await ctx.json('POST', '/api/auth/magic-link', { body: { email: 'New@Example.org' } });
    expect(req.status).toBe(200);
    const token = mail.lastToken();
    expect(token).toBeTruthy();
    expect(mail.sent[0].to).toBe('new@example.org');

    const stored = ctx.db.query<{ token: string }>('SELECT token FROM magic_links');
    expect(stored[0].token).not.toBe(token);
    expect(stored[0].token).toMatch(/^[0-9a-f]{64}$/);

    const first = await ctx.json('POST', '/api/auth/magic-link/verify', { body: { token } });
    expect(first.status).toBe(200);
    expect(first.body.token).toBeTruthy();
    expect(first.body.needsKeySetup).toBe(true);
    expect(first.body.user.email).toBe('new@example.org');

    const second = await ctx.json('POST', '/api/auth/magic-link/verify', { body: { token } });
    expect(second.status).toBe(400);
  });

  it('rejects expired links', async () => {
    const ctx = createTestContext({ RESEND_API_KEY: 're_test' });
    const mail = captureEmails();
    await ctx.json('POST', '/api/auth/magic-link', { body: { email: 'a@example.org' } });
    ctx.db.query("UPDATE magic_links SET expires_at = '2000-01-01T00:00:00.000Z'");
    const res = await ctx.json('POST', '/api/auth/magic-link/verify', { body: { token: mail.lastToken() } });
    expect(res.status).toBe(400);
  });

  it('does not create accounts when sign-ups are disabled', async () => {
    const ctx = createTestContext({ RESEND_API_KEY: 're_test', ALLOW_SIGNUPS: 'false' });
    const mail = captureEmails();
    const res = await ctx.json('POST', '/api/auth/magic-link', { body: { email: 'stranger@example.org' } });
    expect(res.status).toBe(200);
    expect(mail.sent).toHaveLength(0);

    createUser(ctx, 'invited@example.org', { withKeys: false });
    await ctx.json('POST', '/api/auth/magic-link', { body: { email: 'invited@example.org' } });
    expect(mail.sent).toHaveLength(1);
  });

  it('limits links per address', async () => {
    const ctx = createTestContext({ RESEND_API_KEY: 're_test' });
    const mail = captureEmails();
    for (let i = 0; i < 5; i++) {
      await ctx.json('POST', '/api/auth/magic-link', {
        body: { email: 'victim@example.org' },
      });
    }
    expect(mail.sent.length).toBe(3);
  });
});

describe('GitHub OAuth', () => {
  it('requires a state parameter to start', async () => {
    const ctx = createTestContext();
    expect((await ctx.request('GET', '/api/auth/github')).status).toBe(400);
    const ok = await ctx.request('GET', '/api/auth/github?state=abcdefghijklmnopqrstuvwxyz');
    expect(ok.status).toBe(302);
    expect(ok.headers.get('Location')).toContain('state=abcdefghijklmnopqrstuvwxyz');
  });

  it('refuses accounts without a verified primary email', async () => {
    const ctx = createTestContext();
    stubGitHub({ emails: [{ email: 'victim@example.org', primary: true, verified: false }] });
    const res = await ctx.json('POST', '/api/auth/github/callback', { body: { code: 'abc' } });
    expect(res.status).toBe(400);
  });

  it('does not let an unverified email take over an existing account', async () => {
    const ctx = createTestContext();
    createUser(ctx, 'victim@example.org');
    stubGitHub({
      emails: [
        { email: 'attacker@example.org', primary: true, verified: true },
        { email: 'victim@example.org', primary: false, verified: false },
      ],
    });
    const res = await ctx.json('POST', '/api/auth/github/callback', { body: { code: 'abc' } });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('attacker@example.org');
  });

  it('links GitHub to an existing user with the same verified email', async () => {
    const ctx = createTestContext();
    const id = createUser(ctx, 'person@example.org');
    stubGitHub({ id: 7, emails: [{ email: 'person@example.org', primary: true, verified: true }] });
    const res = await ctx.json('POST', '/api/auth/github/callback', { body: { code: 'abc' } });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(id);
    expect(ctx.db.query('SELECT github_id FROM users WHERE id = ?', id)[0].github_id).toBe('7');
  });

  it('rejects an email already linked to a different GitHub account', async () => {
    const ctx = createTestContext();
    const id = createUser(ctx, 'person@example.org');
    ctx.db.query("UPDATE users SET github_id = '1' WHERE id = ?", id);
    stubGitHub({ id: 2, emails: [{ email: 'person@example.org', primary: true, verified: true }] });
    const res = await ctx.json('POST', '/api/auth/github/callback', { body: { code: 'abc' } });
    expect(res.status).toBe(409);
  });
});

describe('sessions', () => {
  it('rejects missing, forged and revoked tokens', async () => {
    const ctx = createTestContext();
    const id = createUser(ctx, 'u@example.org');
    const token = await createToken(ctx, id);

    expect((await ctx.request('GET', '/api/auth/me')).status).toBe(401);
    expect((await ctx.request('GET', '/api/auth/me', { token: token.slice(0, -2) + 'xx' })).status).toBe(401);
    expect((await ctx.request('GET', '/api/auth/me', { token })).status).toBe(200);

    expect((await ctx.request('POST', '/api/auth/logout', { token })).status).toBe(200);
    expect((await ctx.request('GET', '/api/auth/me', { token })).status).toBe(401);
  });

  it('enforces the idle timeout server side', async () => {
    const ctx = createTestContext();
    const id = createUser(ctx, 'u@example.org');
    const idle = await createToken(ctx, id, { timeoutMinutes: 15, lastActivity: Math.floor(Date.now() / 1000) - 16 * 60 });
    const res = await ctx.json('GET', '/api/auth/me', { token: idle });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_TIMEOUT');

    const never = await createToken(ctx, id, { timeoutMinutes: 0, lastActivity: 0 });
    expect((await ctx.request('GET', '/api/auth/me', { token: never })).status).toBe(200);
  });

  it('applies a changed timeout preference to live sessions', async () => {
    const ctx = createTestContext();
    const id = createUser(ctx, 'u@example.org');
    const token = await createToken(ctx, id);
    await ctx.json('PUT', '/api/preferences', { token, body: { sessionTimeout: 60 } });
    expect(ctx.db.query('SELECT timeout_minutes FROM sessions WHERE user_id = ?', id)[0].timeout_minutes).toBe(60);
  });

  it('signs out every session', async () => {
    const ctx = createTestContext();
    const id = createUser(ctx, 'u@example.org');
    const a = await createToken(ctx, id);
    const b = await createToken(ctx, id);
    expect((await ctx.request('POST', '/api/auth/logout-all', { token: a })).status).toBe(200);
    expect((await ctx.request('GET', '/api/auth/me', { token: b })).status).toBe(401);
  });
});

describe('key setup and master password change', () => {
  it('sets keys once, then allows a password change that signs out other sessions', async () => {
    const ctx = createTestContext();
    const id = createUser(ctx, 'u@example.org', { withKeys: false });
    const token = await createToken(ctx, id);
    const other = await createToken(ctx, id);
    const keys = { publicKey: 'cHVibGlj', encryptedPrivateKey: 'cHJpdmF0ZQ==', salt: 'c2FsdA==', kdfIterations: 600000 };

    expect((await ctx.json('PUT', '/api/auth/keys', { token, body: { ...keys } })).status).toBe(409);
    const setup = await ctx.json('POST', '/api/auth/setup-keys', { token, body: keys });
    expect(setup.status).toBe(200);
    expect(setup.body.kdfIterations).toBe(600000);
    expect((await ctx.json('POST', '/api/auth/setup-keys', { token, body: keys })).status).toBe(409);

    const change = await ctx.json('PUT', '/api/auth/keys', {
      token,
      body: { encryptedPrivateKey: 'bmV3', salt: 'bmV3c2FsdA==', kdfIterations: 700000 },
    });
    expect(change.status).toBe(200);
    expect(change.body.publicKey).toBe('cHVibGlj');
    expect((await ctx.request('GET', '/api/auth/me', { token })).status).toBe(200);
    expect((await ctx.request('GET', '/api/auth/me', { token: other })).status).toBe(401);
  });
});
