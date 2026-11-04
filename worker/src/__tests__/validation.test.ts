import { describe, expect, it } from 'vitest';
import {
  auditActionSchema,
  createCategorySchema,
  createOrgSchema,
  createSecretSchema,
  createShareLinkSchema,
  inviteUserSchema,
  magicLinkVerifySchema,
  secretTypeSchema,
  updatePreferencesSchema,
  updateSecretSchema,
  ValidationError,
  webUrlSchema,
} from '../lib/validation';
import { AUDIT_ACTIONS } from '../middleware/audit';

const IV = '0'.repeat(24);
const validSecret = { name: 'Test Secret', ciphertextBlob: 'abcdef0123', iv: IV };

describe('secret schemas', () => {
  it('accepts every secret type and rejects others', () => {
    for (const t of ['password', 'note', 'api_key', 'card', 'totp']) expect(secretTypeSchema.parse(t)).toBe(t);
    expect(() => secretTypeSchema.parse('invalid')).toThrow();
  });

  it('applies defaults and accepts optional fields', () => {
    const parsed = createSecretSchema.parse(validSecret);
    expect(parsed.secretType).toBe('password');
    expect(parsed.encVersion).toBe(1);

    const full = createSecretSchema.parse({
      ...validSecret,
      id: '550e8400-e29b-41d4-a716-446655440000',
      url: 'https://example.com',
      usernameHint: 'user@example.com',
      categoryId: '550e8400-e29b-41d4-a716-446655440001',
      secretType: 'api_key',
      tags: ['work'],
      expiresAt: '2030-12-31T23:59:59Z',
      encVersion: 2,
    });
    expect(full.encVersion).toBe(2);
  });

  it('requires hex ciphertext and a 12-byte hex IV', () => {
    expect(() => createSecretSchema.parse({ ...validSecret, ciphertextBlob: 'not hex!' })).toThrow();
    expect(() => createSecretSchema.parse({ ...validSecret, iv: 'abc' })).toThrow();
    expect(() => createSecretSchema.parse({ ...validSecret, ciphertextBlob: '' })).toThrow();
  });

  it('limits names and tags', () => {
    expect(() => createSecretSchema.parse({ ...validSecret, name: '' })).toThrow();
    expect(() => createSecretSchema.parse({ ...validSecret, name: 'a'.repeat(201) })).toThrow();
    expect(() => createSecretSchema.parse({ ...validSecret, tags: Array(21).fill('t') })).toThrow();
    expect(() => createSecretSchema.parse({ ...validSecret, tags: ['a'.repeat(51)] })).toThrow();
  });

  it('requires ciphertext and IV to change together', () => {
    expect(updateSecretSchema.parse({ name: 'Renamed' }).name).toBe('Renamed');
    expect(() => updateSecretSchema.parse({ ciphertextBlob: 'ab' })).toThrow();
    expect(updateSecretSchema.parse({ ciphertextBlob: 'ab', iv: IV }).iv).toBe(IV);
  });
});

describe('URL safety', () => {
  it('accepts http(s) and empty, rejects script and data URLs', () => {
    expect(webUrlSchema.parse('https://example.com/login')).toBe('https://example.com/login');
    expect(webUrlSchema.parse('')).toBe('');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'not a url']) {
      expect(() => webUrlSchema.parse(bad), bad).toThrow();
    }
  });
});

describe('org and member schemas', () => {
  it('trims org names and requires a key', () => {
    expect(createOrgSchema.parse({ name: '  Board  ', encryptedOrgKey: 'a2V5' }).name).toBe('Board');
    expect(() => createOrgSchema.parse({ name: 'x', encryptedOrgKey: 'not base64!' })).toThrow();
  });

  it('normalizes invite emails and validates roles', () => {
    expect(inviteUserSchema.parse({ email: ' Person@Example.ORG ' })).toEqual({ email: 'person@example.org', role: 'member' });
    expect(() => inviteUserSchema.parse({ email: 'a@b.co', role: 'owner' })).toThrow();
  });
});

describe('other schemas', () => {
  it('validates categories', () => {
    expect(createCategorySchema.parse({ name: 'Work' })).toEqual({ name: 'Work', icon: 'folder', color: '#6366f1' });
    expect(() => createCategorySchema.parse({ name: 'Work', color: 'red' })).toThrow();
    expect(() => createCategorySchema.parse({ name: 'Work', icon: '<script>' })).toThrow();
  });

  it('validates preferences', () => {
    expect(updatePreferencesSchema.parse({ sessionTimeout: 0 }).sessionTimeout).toBe(0);
    expect(() => updatePreferencesSchema.parse({ sessionTimeout: -1 })).toThrow();
    expect(() => updatePreferencesSchema.parse({ theme: 'blue' })).toThrow();
  });

  it('validates magic link tokens', () => {
    expect(() => magicLinkVerifySchema.parse({ token: 'short' })).toThrow();
    expect(magicLinkVerifySchema.parse({ token: 'a'.repeat(43) }).token).toHaveLength(43);
  });

  it('requires share password salt and verifier together', () => {
    const base = { id: '550e8400-e29b-41d4-a716-446655440000', ciphertextBlob: 'ab', iv: IV, expiresInHours: 1 };
    expect(createShareLinkSchema.parse(base).maxViews).toBe(1);
    expect(() => createShareLinkSchema.parse({ ...base, accessSalt: 'c2FsdA==' })).toThrow();
  });

  it('derives the audit action filter from the single action list', () => {
    for (const action of AUDIT_ACTIONS) expect(auditActionSchema.parse(action)).toBe(action);
    expect(() => auditActionSchema.parse('DROP_TABLE')).toThrow();
  });

  it('exposes ValidationError', () => {
    const err = new ValidationError('bad');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ValidationError');
  });
});
