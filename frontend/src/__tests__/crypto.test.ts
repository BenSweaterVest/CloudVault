// @vitest-environment node
/**
 * Crypto library tests. Run in the Node environment: Web Crypto there uses
 * the same realm as the test's typed arrays (jsdom does not).
 */

import { describe, expect, it } from 'vitest';
import {
  CURRENT_KDF_ITERATIONS,
  bufferToHex,
  createOrganizationKeys,
  createShareAccessVerifier,
  createSharePackage,
  decryptOrgKey,
  decryptSecretPayload,
  deriveShareAccessToken,
  encryptOrgKeyFor,
  encryptSecretPayload,
  exportPublicKey,
  generateKeyPair,
  hexToBytes,
  keyFingerprint,
  normalizePayload,
  openSharePackage,
  publicKeyFromPrivateKey,
  randomBytes,
  setupUserKeys,
  sha256Hex,
  unwrapPrivateKey,
  wrapPrivateKey,
} from '../lib/crypto';

const ORG = '11111111-1111-4111-8111-111111111111';
const SECRET = '22222222-2222-4222-8222-222222222222';
const FAST = 100_000;

describe('encoding', () => {
  it('round-trips hex and rejects bad input', () => {
    const bytes = randomBytes(16);
    expect(hexToBytes(bufferToHex(bytes))).toEqual(bytes);
    expect(() => hexToBytes('abc')).toThrow();
    expect(() => hexToBytes('zz')).toThrow();
  });
});

describe('user keys', () => {
  it('sets up keys with the current KDF and unlocks only with the right password', async () => {
    const keys = await setupUserKeys('correct horse battery staple');
    expect(keys.kdfIterations).toBe(CURRENT_KDF_ITERATIONS);

    const privateKey = await unwrapPrivateKey(keys.encryptedPrivateKey, keys.salt, 'correct horse battery staple', keys.kdfIterations);
    expect(await publicKeyFromPrivateKey(privateKey)).toBe(keys.publicKey);

    await expect(unwrapPrivateKey(keys.encryptedPrivateKey, keys.salt, 'wrong password', keys.kdfIterations)).rejects.toThrow();
  }, 30_000);

  it('re-wraps a key under a new password and iteration count (master password change)', async () => {
    const pair = await generateKeyPair();
    const legacy = await wrapPrivateKey(pair.privateKey, 'old password', FAST);
    const unlocked = await unwrapPrivateKey(legacy.encryptedPrivateKey, legacy.salt, 'old password', FAST);
    const upgraded = await wrapPrivateKey(unlocked, 'new password', 200_000);
    expect(upgraded.salt).not.toBe(legacy.salt);
    const again = await unwrapPrivateKey(upgraded.encryptedPrivateKey, upgraded.salt, 'new password', 200_000);
    expect(await publicKeyFromPrivateKey(again)).toBe(await exportPublicKey(pair.publicKey));
  }, 30_000);

  it('formats fingerprints as eight groups of four hex digits', async () => {
    const pair = await generateKeyPair();
    const fp = await keyFingerprint(await exportPublicKey(pair.publicKey));
    expect(fp).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);
  }, 30_000);
});

describe('organization flow', () => {
  it('lets an admin share the org key with a member who can then decrypt', async () => {
    const admin = await generateKeyPair();
    const member = await generateKeyPair();
    const { orgKey, encryptedOrgKey } = await createOrganizationKeys(await exportPublicKey(admin.publicKey));

    const adminCopy = await decryptOrgKey(encryptedOrgKey, admin.privateKey);
    const forMember = await encryptOrgKeyFor(adminCopy, await exportPublicKey(member.publicKey));
    const memberCopy = await decryptOrgKey(forMember, member.privateKey);

    const enc = await encryptSecretPayload({ username: 'treasurer', password: 's3cret!' }, orgKey, ORG, SECRET);
    expect(enc.encVersion).toBe(2);
    expect(await decryptSecretPayload(enc, memberCopy, ORG, SECRET)).toMatchObject({ username: 'treasurer', password: 's3cret!' });
    await expect(decryptOrgKey(forMember, admin.privateKey)).rejects.toThrow();
  }, 30_000);
});

describe('secret payloads', () => {
  it('binds format 2 ciphertext to its org and secret id', async () => {
    const { orgKey } = await createOrganizationKeys(await exportPublicKey((await generateKeyPair()).publicKey));
    const enc = await encryptSecretPayload({ password: 'x' }, orgKey, ORG, SECRET);
    await expect(decryptSecretPayload(enc, orgKey, ORG, '33333333-3333-4333-8333-333333333333')).rejects.toThrow();
    await expect(decryptSecretPayload(enc, orgKey, '44444444-4444-4444-8444-444444444444', SECRET)).rejects.toThrow();
  }, 30_000);

  it('still reads legacy format 1 (no associated data)', async () => {
    const orgKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const iv = randomBytes(12);
    const legacy = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      orgKey,
      new TextEncoder().encode(JSON.stringify({ username: 'old', password: 'pw', notes: 'n', totpSecret: 'JBSWY3DPEHPK3PXP' }))
    );
    const payload = await decryptSecretPayload({ ciphertextBlob: bufferToHex(legacy), iv: bufferToHex(iv), encVersion: 1 }, orgKey, ORG, SECRET);
    expect(payload).toMatchObject({ username: 'old', password: 'pw', notes: 'n', totp: 'JBSWY3DPEHPK3PXP' });
  });

  it('produces a fresh IV every time', async () => {
    const orgKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const a = await encryptSecretPayload({ password: 'same' }, orgKey, ORG, SECRET);
    const b = await encryptSecretPayload({ password: 'same' }, orgKey, ORG, SECRET);
    expect(a.iv).not.toBe(b.iv);
    expect(a.iv).toMatch(/^[0-9a-f]{24}$/);
  });

  it('normalizes unknown or malformed payloads', () => {
    expect(normalizePayload({ password: 1, card: { number: '4111' }, customFields: [{ label: 'PIN', value: 12, hidden: 1 }, null] })).toEqual({
      username: undefined,
      password: undefined,
      notes: undefined,
      totp: undefined,
      apiKey: undefined,
      card: { holder: undefined, number: '4111', expiry: undefined, cvv: undefined, pin: undefined },
      customFields: [{ label: 'PIN', value: '12', hidden: true }],
    });
  });
});

describe('share links', () => {
  it('round-trips with the fragment key and is bound to the link id', async () => {
    const pkg = await createSharePackage({ password: 'wifi-password' }, 'link-1');
    expect(pkg.fragmentKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await openSharePackage(pkg, pkg.fragmentKey, 'link-1')).toMatchObject({ password: 'wifi-password' });
    await expect(openSharePackage(pkg, pkg.fragmentKey, 'link-2')).rejects.toThrow();
    await expect(openSharePackage(pkg, 'A'.repeat(43), 'link-1')).rejects.toThrow();
  });

  it('derives a password verifier the server can check without the password', async () => {
    const { accessSalt, accessVerifier } = await createShareAccessVerifier('hunter22');
    const token = await deriveShareAccessToken('hunter22', accessSalt);
    expect(await sha256Hex(token)).toBe(accessVerifier);
    expect(await sha256Hex(await deriveShareAccessToken('hunter23', accessSalt))).not.toBe(accessVerifier);
  });
});
