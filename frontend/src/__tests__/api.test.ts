import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SESSION_ENDED_EVENT, authApi, secretsApi, sharingApi, tokenStore } from '../lib/api';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('API client', () => {
  it('sends the bearer token and JSON body', async () => {
    tokenStore.set('tok');
    fetchMock.mockResolvedValue(json(200, { success: true }));
    await secretsApi.toggleFavorite('org', 'sec', true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/organizations/org/secrets/sec/favorite');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ isFavorite: true });
  });

  it('surfaces the server error message and code', async () => {
    fetchMock.mockResolvedValue(json(409, { error: 'Changed by someone else', code: 'VERSION_CONFLICT' }));
    const err = await secretsApi.update('o', 's', { name: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Changed by someone else');
    expect(err.code).toBe('VERSION_CONFLICT');
    expect(err.status).toBe(409);
  });

  it('announces ended sessions', async () => {
    tokenStore.set('tok');
    const listener = vi.fn();
    window.addEventListener(SESSION_ENDED_EVENT, listener);
    fetchMock.mockResolvedValue(json(401, { error: 'Session timed out', code: 'SESSION_TIMEOUT' }));
    await authApi.getCurrentUser().catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_ENDED_EVENT, listener);
  });

  it('does not end the session on a wrong share link password', async () => {
    tokenStore.set('tok');
    const listener = vi.fn();
    window.addEventListener(SESSION_ENDED_EVENT, listener);
    fetchMock.mockResolvedValue(json(401, { error: 'Incorrect password', code: 'PASSWORD_INCORRECT' }));
    await sharingApi.publicAccess('link', 'ab').catch(() => undefined);
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(SESSION_ENDED_EVENT, listener);
  });

  it('reports network failures clearly', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await authApi.getCurrentUser().catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/reach the server/);
  });

  it('clears the token on logout even if the request fails', async () => {
    tokenStore.set('tok');
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await authApi.logout();
    expect(tokenStore.get()).toBeNull();
  });

  it('builds the GitHub URL with the state', () => {
    expect(authApi.githubAuthUrl('abc')).toBe('/api/auth/github?state=abc');
  });
});
