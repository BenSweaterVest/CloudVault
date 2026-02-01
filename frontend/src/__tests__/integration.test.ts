/**
 * Integration Tests
 * 
 * Tests for complete user flows and feature interactions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateMasterKeyFromPassword,
  deriveKeyFromPassword,
  generateKeyPair,
  generateOrgKey,
  encryptWithOrgKey,
  decryptWithOrgKey,
  encryptPrivateKey,
  decryptPrivateKey,
  encryptOrgKeyForUser,
  decryptOrgKeyWithPrivateKey,
  exportPublicKey,
  importPublicKey,
} from '../lib/crypto';

describe('Full User Registration Flow', () => {
  it('should complete registration and setup flow', async () => {
    // Simulate user registration
    const email = 'newuser@example.com';
    const masterPassword = 'StrongP@ssw0rd!123';

    // Step 1: Generate master key from password
    const { key: masterKey, salt } = await generateMasterKeyFromPassword(masterPassword);
    expect(masterKey).toBeDefined();
    expect(salt).toBeDefined();
    expect(salt.length).toBeGreaterThan(0);

    // Step 2: Generate RSA key pair
    const { publicKey, privateKey } = await generateKeyPair();
    expect(publicKey).toBeDefined();
    expect(privateKey).toBeDefined();

    // Step 3: Encrypt private key with master key
    const encryptedPrivateKey = await encryptPrivateKey(privateKey, masterKey);
    expect(encryptedPrivateKey).toBeDefined();
    expect(typeof encryptedPrivateKey).toBe('string');

    // Step 4: Export public key for storage
    const publicKeyString = await exportPublicKey(publicKey);
    expect(publicKeyString).toBeDefined();
    expect(publicKeyString.length).toBeGreaterThan(0);

    // Verify we can import the public key back
    const reimportedPublicKey = await importPublicKey(publicKeyString);
    expect(reimportedPublicKey).toBeDefined();
  });
});

describe('Organization Creation Flow', () => {
  it('should create organization and encrypt key for creator', async () => {
    // Setup user keys first
    const masterPassword = 'UserP@ssw0rd!';
    const { key: masterKey, salt } = await generateMasterKeyFromPassword(masterPassword);
    const { publicKey, privateKey } = await generateKeyPair();

    // Create organization
    // Step 1: Generate organization encryption key
    const orgKey = await generateOrgKey();
    expect(orgKey).toBeDefined();
    expect(orgKey.type).toBe('secret');

    // Step 2: Encrypt org key for the creator
    const encryptedOrgKey = await encryptOrgKeyForUser(orgKey, publicKey);
    expect(encryptedOrgKey).toBeDefined();

    // Verify creator can decrypt the org key
    const decryptedOrgKey = await decryptOrgKeyWithPrivateKey(encryptedOrgKey, privateKey);
    expect(decryptedOrgKey).toBeDefined();
    expect(decryptedOrgKey.type).toBe('secret');
  });
});

describe('Secret Encryption Flow', () => {
  let orgKey: CryptoKey;

  beforeEach(async () => {
    orgKey = await generateOrgKey();
  });

  it('should encrypt and decrypt password secret', async () => {
    const secretData = {
      username: 'user@example.com',
      password: 'SecretP@ssw0rd!',
      notes: 'Login for production server',
    };

    // Encrypt
    const { ciphertext, iv } = await encryptWithOrgKey(orgKey, secretData);
    expect(ciphertext).toBeDefined();
    expect(iv).toBeDefined();

    // Decrypt
    const decrypted = await decryptWithOrgKey(orgKey, ciphertext, iv);
    expect(decrypted).toEqual(secretData);
  });

  it('should encrypt and decrypt secure note', async () => {
    const noteData = {
      content: 'This is a secure note with sensitive information.\n\nMultiple lines supported.',
    };

    const { ciphertext, iv } = await encryptWithOrgKey(orgKey, noteData);
    const decrypted = await decryptWithOrgKey(orgKey, ciphertext, iv);

    expect(decrypted).toEqual(noteData);
  });

  it('should encrypt and decrypt API key', async () => {
    const apiKeyData = {
      apiKey: 'sk_live_51234567890abcdef',
      environment: 'production',
      service: 'Stripe',
    };

    const { ciphertext, iv } = await encryptWithOrgKey(orgKey, apiKeyData);
    const decrypted = await decryptWithOrgKey(orgKey, ciphertext, iv);

    expect(decrypted).toEqual(apiKeyData);
  });

  it('should encrypt and decrypt credit card', async () => {
    const cardData = {
      cardNumber: '4111111111111111',
      expiryMonth: '12',
      expiryYear: '2025',
      cvv: '123',
      cardholderName: 'John Doe',
    };

    const { ciphertext, iv } = await encryptWithOrgKey(orgKey, cardData);
    const decrypted = await decryptWithOrgKey(orgKey, ciphertext, iv);

    expect(decrypted).toEqual(cardData);
  });

  it('should encrypt and decrypt TOTP secret', async () => {
    const totpData = {
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: 'GitHub',
      accountName: 'user@example.com',
      digits: 6,
      period: 30,
    };

    const { ciphertext, iv } = await encryptWithOrgKey(orgKey, totpData);
    const decrypted = await decryptWithOrgKey(orgKey, ciphertext, iv);

    expect(decrypted).toEqual(totpData);
  });
});

describe('Multi-User Access Flow', () => {
  it('should allow multiple users to access same organization', async () => {
    // User A creates the organization
    const userAPassword = 'UserAP@ss!';
    const { key: userAMasterKey } = await generateMasterKeyFromPassword(userAPassword);
    const { publicKey: userAPublicKey, privateKey: userAPrivateKey } = await generateKeyPair();
    const userAPublicKeyString = await exportPublicKey(userAPublicKey);

    // Create org key
    const orgKey = await generateOrgKey();

    // Encrypt org key for User A
    const encryptedOrgKeyForA = await encryptOrgKeyForUser(orgKey, userAPublicKey);

    // User B joins the organization
    const userBPassword = 'UserBP@ss!';
    const { key: userBMasterKey } = await generateMasterKeyFromPassword(userBPassword);
    const { publicKey: userBPublicKey, privateKey: userBPrivateKey } = await generateKeyPair();
    const userBPublicKeyString = await exportPublicKey(userBPublicKey);

    // Admin (User A) needs to:
    // 1. Decrypt the org key with their private key
    const decryptedOrgKey = await decryptOrgKeyWithPrivateKey(encryptedOrgKeyForA, userAPrivateKey);

    // 2. Re-encrypt the org key for User B
    const userBImportedPublicKey = await importPublicKey(userBPublicKeyString);
    const encryptedOrgKeyForB = await encryptOrgKeyForUser(decryptedOrgKey, userBImportedPublicKey);

    // User B can now decrypt the org key
    const userBDecryptedOrgKey = await decryptOrgKeyWithPrivateKey(encryptedOrgKeyForB, userBPrivateKey);
    expect(userBDecryptedOrgKey).toBeDefined();

    // Both users can encrypt/decrypt secrets
    const testSecret = { password: 'shared-secret' };

    // User A encrypts
    const { ciphertext, iv } = await encryptWithOrgKey(decryptedOrgKey, testSecret);

    // User B decrypts
    const decryptedByB = await decryptWithOrgKey(userBDecryptedOrgKey, ciphertext, iv);
    expect(decryptedByB).toEqual(testSecret);
  });
});

describe('Vault Lock/Unlock Flow', () => {
  it('should properly lock and unlock vault', async () => {
    // Initial setup
    const masterPassword = 'V@ultP@ssw0rd!';
    const { key: masterKey, salt } = await generateMasterKeyFromPassword(masterPassword);
    const { publicKey, privateKey } = await generateKeyPair();
    const encryptedPrivateKey = await encryptPrivateKey(privateKey, masterKey);

    // Create org and secret
    const orgKey = await generateOrgKey();
    const encryptedOrgKey = await encryptOrgKeyForUser(orgKey, publicKey);
    const secret = { password: 'my-secret-password' };
    const { ciphertext, iv } = await encryptWithOrgKey(orgKey, secret);

    // Simulate "lock" - clear keys from memory
    // (In real app, keys would be held in React state/context)

    // Simulate "unlock" - re-derive keys from password
    const derivedKey = await deriveKeyFromPassword(masterPassword, salt);
    const unlockedPrivateKey = await decryptPrivateKey(encryptedPrivateKey, derivedKey);
    const unlockedOrgKey = await decryptOrgKeyWithPrivateKey(encryptedOrgKey, unlockedPrivateKey);

    // Should be able to decrypt secrets again
    const decrypted = await decryptWithOrgKey(unlockedOrgKey, ciphertext, iv);
    expect(decrypted).toEqual(secret);
  });

  it('should fail unlock with wrong password', async () => {
    const correctPassword = 'CorrectP@ss!';
    const wrongPassword = 'WrongP@ss!';

    const { key: masterKey, salt } = await generateMasterKeyFromPassword(correctPassword);
    const { publicKey, privateKey } = await generateKeyPair();
    const encryptedPrivateKey = await encryptPrivateKey(privateKey, masterKey);

    // Try to unlock with wrong password
    const wrongDerivedKey = await deriveKeyFromPassword(wrongPassword, salt);

    // Should throw when trying to decrypt private key
    await expect(
      decryptPrivateKey(encryptedPrivateKey, wrongDerivedKey)
    ).rejects.toThrow();
  });
});

describe('Secret Update Flow', () => {
  it('should maintain history when updating secrets', async () => {
    const orgKey = await generateOrgKey();

    // Original secret
    const v1 = { password: 'original-password' };
    const encrypted1 = await encryptWithOrgKey(orgKey, v1);

    // Update secret (new version)
    const v2 = { password: 'updated-password' };
    const encrypted2 = await encryptWithOrgKey(orgKey, v2);

    // Both versions should be decryptable
    const decrypted1 = await decryptWithOrgKey(orgKey, encrypted1.ciphertext, encrypted1.iv);
    const decrypted2 = await decryptWithOrgKey(orgKey, encrypted2.ciphertext, encrypted2.iv);

    expect(decrypted1).toEqual(v1);
    expect(decrypted2).toEqual(v2);
    expect(decrypted1).not.toEqual(decrypted2);
  });
});

describe('Error Recovery', () => {
  it('should gracefully handle corrupted ciphertext', async () => {
    const orgKey = await generateOrgKey();
    const secret = { password: 'test' };
    const { ciphertext, iv } = await encryptWithOrgKey(orgKey, secret);

    // Corrupt the ciphertext
    const corruptedCiphertext = ciphertext.slice(0, -5) + 'XXXXX';

    await expect(
      decryptWithOrgKey(orgKey, corruptedCiphertext, iv)
    ).rejects.toThrow();
  });

  it('should gracefully handle wrong IV', async () => {
    const orgKey = await generateOrgKey();
    const secret = { password: 'test' };
    const { ciphertext } = await encryptWithOrgKey(orgKey, secret);

    // Generate different IV
    const wrongIv = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))));

    await expect(
      decryptWithOrgKey(orgKey, ciphertext, wrongIv)
    ).rejects.toThrow();
  });
});
