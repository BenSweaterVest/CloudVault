/**
 * Crypto Module Tests
 * 
 * Tests for the zero-knowledge encryption utilities.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateMasterKeyFromPassword,
  deriveKeyFromPassword,
  generateKeyPair,
  generateOrgKey,
  encryptWithOrgKey,
  decryptWithOrgKey,
  encryptOrgKeyForUser,
  decryptOrgKeyWithPrivateKey,
  encryptPrivateKey,
  decryptPrivateKey,
} from '../lib/crypto';

describe('Crypto Module', () => {
  const testPassword = 'TestPassword123!';
  const testSalt = 'test-salt-123456';
  const testData = { username: 'testuser', password: 'secretpassword' };

  describe('Key Derivation', () => {
    it('should derive a consistent key from password and salt', async () => {
      const key1 = await deriveKeyFromPassword(testPassword, testSalt);
      const key2 = await deriveKeyFromPassword(testPassword, testSalt);
      
      // Export keys to compare
      const exported1 = await crypto.subtle.exportKey('raw', key1);
      const exported2 = await crypto.subtle.exportKey('raw', key2);
      
      expect(new Uint8Array(exported1)).toEqual(new Uint8Array(exported2));
    });

    it('should derive different keys for different passwords', async () => {
      const key1 = await deriveKeyFromPassword(testPassword, testSalt);
      const key2 = await deriveKeyFromPassword('DifferentPassword456!', testSalt);
      
      const exported1 = await crypto.subtle.exportKey('raw', key1);
      const exported2 = await crypto.subtle.exportKey('raw', key2);
      
      expect(new Uint8Array(exported1)).not.toEqual(new Uint8Array(exported2));
    });

    it('should derive different keys for different salts', async () => {
      const key1 = await deriveKeyFromPassword(testPassword, testSalt);
      const key2 = await deriveKeyFromPassword(testPassword, 'different-salt-789');
      
      const exported1 = await crypto.subtle.exportKey('raw', key1);
      const exported2 = await crypto.subtle.exportKey('raw', key2);
      
      expect(new Uint8Array(exported1)).not.toEqual(new Uint8Array(exported2));
    });
  });

  describe('RSA Key Pair', () => {
    it('should generate a valid RSA key pair', async () => {
      const { publicKey, privateKey } = await generateKeyPair();
      
      expect(publicKey).toBeDefined();
      expect(privateKey).toBeDefined();
      expect(publicKey.type).toBe('public');
      expect(privateKey.type).toBe('private');
    });
  });

  describe('Organization Key Encryption', () => {
    it('should generate a valid org key', async () => {
      const orgKey = await generateOrgKey();
      
      expect(orgKey).toBeDefined();
      expect(orgKey.type).toBe('secret');
    });

    it('should encrypt and decrypt data with org key', async () => {
      const orgKey = await generateOrgKey();
      
      const { ciphertext, iv } = await encryptWithOrgKey(orgKey, testData);
      
      expect(ciphertext).toBeDefined();
      expect(iv).toBeDefined();
      expect(ciphertext.length).toBeGreaterThan(0);
      expect(iv.length).toBeGreaterThan(0);
      
      const decrypted = await decryptWithOrgKey(orgKey, ciphertext, iv);
      
      expect(decrypted).toEqual(testData);
    });

    it('should fail to decrypt with wrong org key', async () => {
      const orgKey1 = await generateOrgKey();
      const orgKey2 = await generateOrgKey();
      
      const { ciphertext, iv } = await encryptWithOrgKey(orgKey1, testData);
      
      await expect(
        decryptWithOrgKey(orgKey2, ciphertext, iv)
      ).rejects.toThrow();
    });
  });

  describe('Private Key Encryption', () => {
    it('should encrypt and decrypt private key with master password', async () => {
      const { publicKey, privateKey } = await generateKeyPair();
      const { key, salt } = await generateMasterKeyFromPassword(testPassword);
      
      const encryptedPrivateKey = await encryptPrivateKey(privateKey, key);
      
      expect(encryptedPrivateKey).toBeDefined();
      
      const decryptedPrivateKey = await decryptPrivateKey(encryptedPrivateKey, key);
      
      // Compare exported key data
      const originalExported = await crypto.subtle.exportKey('pkcs8', privateKey);
      const decryptedExported = await crypto.subtle.exportKey('pkcs8', decryptedPrivateKey);
      
      expect(new Uint8Array(originalExported)).toEqual(new Uint8Array(decryptedExported));
    });
  });

  describe('End-to-End Encryption Flow', () => {
    it('should handle full encryption/decryption workflow', async () => {
      // 1. Generate user key pair
      const { publicKey, privateKey } = await generateKeyPair();
      
      // 2. Generate master key from password
      const { key: masterKey, salt } = await generateMasterKeyFromPassword(testPassword);
      
      // 3. Encrypt private key with master key
      const encryptedPrivateKey = await encryptPrivateKey(privateKey, masterKey);
      
      // 4. Generate org key
      const orgKey = await generateOrgKey();
      
      // 5. Encrypt org key for user
      const encryptedOrgKey = await encryptOrgKeyForUser(orgKey, publicKey);
      
      // 6. Encrypt secret with org key
      const { ciphertext, iv } = await encryptWithOrgKey(orgKey, testData);
      
      // Now simulate a different session where user logs in
      
      // 7. Derive master key from password
      const derivedMasterKey = await deriveKeyFromPassword(testPassword, salt);
      
      // 8. Decrypt private key
      const decryptedPrivateKey = await decryptPrivateKey(encryptedPrivateKey, derivedMasterKey);
      
      // 9. Decrypt org key with private key
      const decryptedOrgKey = await decryptOrgKeyWithPrivateKey(encryptedOrgKey, decryptedPrivateKey);
      
      // 10. Decrypt secret
      const decryptedData = await decryptWithOrgKey(decryptedOrgKey, ciphertext, iv);
      
      expect(decryptedData).toEqual(testData);
    });
  });

  describe('Security Properties', () => {
    it('should produce different ciphertext for same data (random IV)', async () => {
      const orgKey = await generateOrgKey();
      
      const result1 = await encryptWithOrgKey(orgKey, testData);
      const result2 = await encryptWithOrgKey(orgKey, testData);
      
      // Same data should produce different ciphertext due to random IV
      expect(result1.ciphertext).not.toBe(result2.ciphertext);
      expect(result1.iv).not.toBe(result2.iv);
    });

    it('should have proper IV length (96 bits for GCM)', async () => {
      const orgKey = await generateOrgKey();
      const { iv } = await encryptWithOrgKey(orgKey, testData);
      
      // IV is base64 encoded, 12 bytes = 16 base64 characters
      const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
      expect(ivBytes.length).toBe(12);
    });
  });
});
