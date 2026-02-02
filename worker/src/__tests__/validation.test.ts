/**
 * Validation Schema Tests
 * 
 * Tests for Zod validation schemas used across the API.
 */

import { describe, it, expect } from 'vitest';
import {
  createSecretSchema,
  updateSecretSchema,
  createCategorySchema,
  createOrgSchema,
  inviteUserSchema,
  updatePreferencesSchema,
  secretTypeSchema,
  ValidationError,
} from '../lib/validation';

describe('Validation Schemas', () => {
  describe('secretTypeSchema', () => {
    it('should accept valid secret types', () => {
      expect(secretTypeSchema.parse('password')).toBe('password');
      expect(secretTypeSchema.parse('note')).toBe('note');
      expect(secretTypeSchema.parse('api_key')).toBe('api_key');
      expect(secretTypeSchema.parse('card')).toBe('card');
      expect(secretTypeSchema.parse('totp')).toBe('totp');
    });

    it('should reject invalid secret types', () => {
      expect(() => secretTypeSchema.parse('invalid')).toThrow();
      expect(() => secretTypeSchema.parse('')).toThrow();
      expect(() => secretTypeSchema.parse(123)).toThrow();
    });
  });

  describe('createSecretSchema', () => {
    const validSecret = {
      name: 'Test Secret',
      ciphertextBlob: 'encrypted-data-here',
      iv: 'initialization-vector',
    };

    it('should accept valid secret data', () => {
      const result = createSecretSchema.parse(validSecret);
      expect(result.name).toBe('Test Secret');
      expect(result.secretType).toBe('password'); // default
    });

    it('should accept secret with all optional fields', () => {
      const result = createSecretSchema.parse({
        ...validSecret,
        url: 'https://example.com',
        usernameHint: 'user@example.com',
        categoryId: '550e8400-e29b-41d4-a716-446655440000',
        secretType: 'api_key',
        tags: ['work', 'api'],
        expiresAt: '2025-12-31T23:59:59Z',
      });
      
      expect(result.url).toBe('https://example.com');
      expect(result.secretType).toBe('api_key');
      expect(result.tags).toEqual(['work', 'api']);
    });

    it('should reject empty name', () => {
      expect(() => createSecretSchema.parse({
        ...validSecret,
        name: '',
      })).toThrow(/Name is required/);
    });

    it('should reject name that is too long', () => {
      expect(() => createSecretSchema.parse({
        ...validSecret,
        name: 'a'.repeat(201),
      })).toThrow(/Name too long/);
    });

    it('should reject missing ciphertextBlob', () => {
      expect(() => createSecretSchema.parse({
        name: 'Test',
        iv: 'iv',
      })).toThrow();
    });

    it('should reject invalid URL', () => {
      expect(() => createSecretSchema.parse({
        ...validSecret,
        url: 'not-a-url',
      })).toThrow();
    });

    it('should accept empty URL string', () => {
      const result = createSecretSchema.parse({
        ...validSecret,
        url: '',
      });
      expect(result.url).toBe('');
    });

    it('should reject too many tags', () => {
      expect(() => createSecretSchema.parse({
        ...validSecret,
        tags: Array(11).fill('tag'),
      })).toThrow();
    });

    it('should reject tags that are too long', () => {
      expect(() => createSecretSchema.parse({
        ...validSecret,
        tags: ['a'.repeat(51)],
      })).toThrow();
    });
  });

  describe('updateSecretSchema', () => {
    it('should accept partial updates', () => {
      const result = updateSecretSchema.parse({
        name: 'Updated Name',
      });
      expect(result.name).toBe('Updated Name');
    });

    it('should accept empty object (no changes)', () => {
      const result = updateSecretSchema.parse({});
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should accept isFavorite update', () => {
      const result = updateSecretSchema.parse({
        isFavorite: true,
      });
      expect(result.isFavorite).toBe(true);
    });
  });

  describe('createCategorySchema', () => {
    it('should accept valid category', () => {
      const result = createCategorySchema.parse({
        name: 'Work',
      });
      expect(result.name).toBe('Work');
    });

    it('should accept category with optional fields', () => {
      const result = createCategorySchema.parse({
        name: 'Work',
        icon: 'briefcase',
        color: '#ff0000',
      });
      expect(result.icon).toBe('briefcase');
      expect(result.color).toBe('#ff0000');
    });

    it('should reject empty category name', () => {
      expect(() => createCategorySchema.parse({
        name: '',
      })).toThrow();
    });

    it('should reject invalid color format', () => {
      expect(() => createCategorySchema.parse({
        name: 'Test',
        color: 'red', // should be hex
      })).toThrow();
    });
  });

  describe('createOrgSchema', () => {
    it('should accept valid organization', () => {
      const result = createOrgSchema.parse({
        name: 'My Nonprofit',
        encryptedOrgKey: 'encrypted-key-data',
      });
      expect(result.name).toBe('My Nonprofit');
    });

    it('should reject empty organization name', () => {
      expect(() => createOrgSchema.parse({
        name: '',
        encryptedOrgKey: 'key',
      })).toThrow();
    });

    it('should reject missing encryptedOrgKey', () => {
      expect(() => createOrgSchema.parse({
        name: 'Org',
      })).toThrow();
    });
  });

  describe('inviteUserSchema', () => {
    it('should accept valid email', () => {
      const result = inviteUserSchema.parse({
        email: 'user@example.com',
      });
      expect(result.email).toBe('user@example.com');
    });

    it('should accept email with role', () => {
      const result = inviteUserSchema.parse({
        email: 'admin@example.com',
        role: 'admin',
      });
      expect(result.role).toBe('admin');
    });

    it('should reject invalid email', () => {
      expect(() => inviteUserSchema.parse({
        email: 'not-an-email',
      })).toThrow();
    });

    it('should reject invalid role', () => {
      expect(() => inviteUserSchema.parse({
        email: 'user@example.com',
        role: 'superadmin',
      })).toThrow();
    });

    it('should default to member role', () => {
      const result = inviteUserSchema.parse({
        email: 'user@example.com',
      });
      expect(result.role).toBe('member');
    });
  });

  describe('updatePreferencesSchema', () => {
    it('should accept valid preferences', () => {
      const result = updatePreferencesSchema.parse({
        theme: 'dark',
        sessionTimeout: 30,
        clipboardClear: 60,
      });
      expect(result.theme).toBe('dark');
      expect(result.sessionTimeout).toBe(30);
    });

    it('should reject invalid theme', () => {
      expect(() => updatePreferencesSchema.parse({
        theme: 'rainbow',
      })).toThrow();
    });

    it('should reject session timeout below minimum', () => {
      expect(() => updatePreferencesSchema.parse({
        sessionTimeout: -1,
      })).toThrow();
    });

    it('should reject session timeout above maximum', () => {
      expect(() => updatePreferencesSchema.parse({
        sessionTimeout: 500,
      })).toThrow();
    });

    it('should accept all valid themes', () => {
      expect(updatePreferencesSchema.parse({ theme: 'light' }).theme).toBe('light');
      expect(updatePreferencesSchema.parse({ theme: 'dark' }).theme).toBe('dark');
      expect(updatePreferencesSchema.parse({ theme: 'system' }).theme).toBe('system');
    });
  });

  describe('ValidationError', () => {
    it('should create error with message', () => {
      const error = new ValidationError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('ValidationError');
    });

    it('should be instanceof Error', () => {
      const error = new ValidationError('Test');
      expect(error instanceof Error).toBe(true);
      expect(error instanceof ValidationError).toBe(true);
    });
  });
});

describe('Edge Cases', () => {
  describe('Unicode and Special Characters', () => {
    it('should handle unicode in secret names', () => {
      const result = createSecretSchema.parse({
        name: '密码管理 🔐',
        ciphertextBlob: 'data',
        iv: 'iv',
      });
      expect(result.name).toBe('密码管理 🔐');
    });

    it('should handle unicode in category names', () => {
      const result = createCategorySchema.parse({
        name: 'Bancos 🏦',
      });
      expect(result.name).toBe('Bancos 🏦');
    });
  });

  describe('Boundary Values', () => {
    it('should accept minimum length name', () => {
      const result = createSecretSchema.parse({
        name: 'A',
        ciphertextBlob: 'data',
        iv: 'iv',
      });
      expect(result.name).toBe('A');
    });

    it('should accept maximum length name', () => {
      const maxName = 'a'.repeat(200);
      const result = createSecretSchema.parse({
        name: maxName,
        ciphertextBlob: 'data',
        iv: 'iv',
      });
      expect(result.name.length).toBe(200);
    });

    it('should accept exactly 10 tags', () => {
      const result = createSecretSchema.parse({
        name: 'Test',
        ciphertextBlob: 'data',
        iv: 'iv',
        tags: Array(10).fill('tag'),
      });
      expect(result.tags?.length).toBe(10);
    });
  });

  describe('Null and Undefined Handling', () => {
    it('should handle null categoryId', () => {
      const result = createSecretSchema.parse({
        name: 'Test',
        ciphertextBlob: 'data',
        iv: 'iv',
        categoryId: null,
      });
      expect(result.categoryId).toBeNull();
    });

    it('should handle null expiresAt', () => {
      const result = createSecretSchema.parse({
        name: 'Test',
        ciphertextBlob: 'data',
        iv: 'iv',
        expiresAt: null,
      });
      expect(result.expiresAt).toBeNull();
    });
  });
});
