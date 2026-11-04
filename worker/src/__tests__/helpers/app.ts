/**
 * Test helpers: a fresh database and environment per test, plus shortcuts
 * for creating users, sessions and organizations directly in the database.
 */

import * as jose from 'jose';
import { app } from '../../index';
import type { Env } from '../../env';
import { TestD1 } from './d1';

export const JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

/** Valid-looking key material (format only; the server never decrypts it). */
export const FAKE_PUBLIC_KEY = 'TUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUF0ZXN0';
export const FAKE_ENCRYPTED_KEY = 'ZW5jcnlwdGVkLW9yZy1rZXktZm9yLXRlc3Rpbmc=';
export const FAKE_SALT = 'c2FsdHNhbHRzYWx0c2FsdA==';
export const IV = 'a'.repeat(24);
export const CIPHERTEXT = 'deadbeef'.repeat(8);

export interface TestContext {
  db: TestD1;
  env: Env;
  waitUntil: Promise<unknown>[];
  request: (method: string, path: string, options?: { token?: string; body?: unknown; headers?: Record<string, string> }) => Promise<Response>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: <T = any>(method: string, path: string, options?: { token?: string; body?: unknown }) => Promise<{ status: number; body: T }>;
}

export function createTestContext(overrides: Partial<Env> = {}): TestContext {
  const db = new TestD1();
  const env = {
    DB: db as unknown as D1Database,
    GITHUB_CLIENT_ID: 'gh-client',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    JWT_SECRET,
    APP_URL: 'https://vault.example.org',
    ENVIRONMENT: 'production',
    ...overrides,
  } as Env;
  const waitUntil: Promise<unknown>[] = [];
  const executionCtx = {
    waitUntil: (p: Promise<unknown>) => void waitUntil.push(p),
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext;

  const request: TestContext['request'] = async (method, path, options = {}) => {
    const headers: Record<string, string> = { 'CF-Connecting-IP': '203.0.113.7', ...options.headers };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await app.request(
      path,
      { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) },
      env,
      executionCtx
    );
    await Promise.all(waitUntil.splice(0));
    return res;
  };

  const json: TestContext['json'] = async (method, path, options) => {
    const res = await request(method, path, options);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  return { db, env, waitUntil, request, json };
}

export function createUser(ctx: TestContext, email: string, options: { withKeys?: boolean; name?: string } = {}): string {
  const id = crypto.randomUUID();
  const withKeys = options.withKeys ?? true;
  ctx.db.query(
    'INSERT INTO users (id, email, name, auth_provider, public_key, encrypted_private_key, salt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    email,
    options.name ?? email.split('@')[0],
    'magic_link',
    withKeys ? FAKE_PUBLIC_KEY : null,
    withKeys ? FAKE_ENCRYPTED_KEY : null,
    withKeys ? FAKE_SALT : null
  );
  return id;
}

export async function createToken(ctx: TestContext, userId: string, options: { timeoutMinutes?: number; lastActivity?: number } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  ctx.db.query(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, last_activity_at, timeout_minutes) VALUES (?, ?, ?, ?, ?, ?)',
    sessionId,
    userId,
    now,
    now + 86_400,
    options.lastActivity ?? now,
    options.timeoutMinutes ?? 15
  );
  return new jose.SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(sessionId)
    .setIssuedAt(now)
    .setExpirationTime(now + 86_400)
    .sign(new TextEncoder().encode(JWT_SECRET));
}

export async function createUserWithToken(ctx: TestContext, email: string, options: { withKeys?: boolean } = {}) {
  const id = createUser(ctx, email, options);
  return { id, token: await createToken(ctx, id) };
}

export function addMember(ctx: TestContext, orgId: string, userId: string, role: 'admin' | 'member' | 'read_only', status: 'active' | 'pending' = 'active') {
  ctx.db.query(
    'INSERT INTO memberships (user_id, org_id, role, encrypted_org_key, status) VALUES (?, ?, ?, ?, ?)',
    userId,
    orgId,
    role,
    status === 'active' ? FAKE_ENCRYPTED_KEY : null,
    status
  );
}

/** An org with an admin, a member and a read-only user, each with a token. */
export async function createOrgFixture(ctx: TestContext) {
  const admin = await createUserWithToken(ctx, 'admin@example.org');
  const res = await ctx.json('POST', '/api/organizations', {
    token: admin.token,
    body: { name: 'Test Org', encryptedOrgKey: FAKE_ENCRYPTED_KEY },
  });
  if (res.status !== 201) throw new Error(`org create failed: ${JSON.stringify(res.body)}`);
  const orgId = res.body.id as string;

  const member = await createUserWithToken(ctx, 'member@example.org');
  addMember(ctx, orgId, member.id, 'member');
  const reader = await createUserWithToken(ctx, 'reader@example.org');
  addMember(ctx, orgId, reader.id, 'read_only');
  const outsider = await createUserWithToken(ctx, 'outsider@example.org');

  return { orgId, admin, member, reader, outsider };
}

export function secretBody(overrides: Record<string, unknown> = {}) {
  return { id: crypto.randomUUID(), name: 'Bank', ciphertextBlob: CIPHERTEXT, iv: IV, encVersion: 2, ...overrides };
}
