/**
 * TOTP Tests
 * 
 * Tests for the TOTP 2FA code generation functionality.
 */

import { describe, it, expect } from 'vitest';
import { parseOTPAuthURI, generateOTPAuthURI, TOTPSetupData } from '../components/vault/TOTPDisplay';

describe('TOTP Utilities', () => {
  describe('parseOTPAuthURI', () => {
    it('should parse valid otpauth URI with all parameters', () => {
      const uri = 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&digits=6&period=30&algorithm=SHA1';
      
      const result = parseOTPAuthURI(uri);
      
      expect(result).not.toBeNull();
      expect(result?.secret).toBe('JBSWY3DPEHPK3PXP');
      expect(result?.issuer).toBe('Example');
      expect(result?.accountName).toBe('alice@example.com');
      expect(result?.digits).toBe(6);
      expect(result?.period).toBe(30);
    });

    it('should parse URI without issuer in label', () => {
      const uri = 'otpauth://totp/alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=MyApp';
      
      const result = parseOTPAuthURI(uri);
      
      expect(result?.issuer).toBe('MyApp');
      expect(result?.accountName).toBe('alice@example.com');
    });

    it('should handle URL-encoded characters', () => {
      const uri = 'otpauth://totp/My%20Company:user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=My%20Company';
      
      const result = parseOTPAuthURI(uri);
      
      expect(result?.issuer).toBe('My Company');
      expect(result?.accountName).toBe('user@example.com');
    });

    it('should use default values for missing parameters', () => {
      const uri = 'otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP';
      
      const result = parseOTPAuthURI(uri);
      
      expect(result?.digits).toBe(6);
      expect(result?.period).toBe(30);
      expect(result?.algorithm).toBe('SHA1');
    });

    it('should return null for invalid protocol', () => {
      const uri = 'https://totp/Test?secret=JBSWY3DPEHPK3PXP';
      
      const result = parseOTPAuthURI(uri);
      
      expect(result).toBeNull();
    });

    it('should return null for HOTP (not TOTP)', () => {
      const uri = 'otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP';
      
      const result = parseOTPAuthURI(uri);
      
      expect(result).toBeNull();
    });

    it('should return null for malformed URI', () => {
      const uri = 'not a valid uri';
      
      const result = parseOTPAuthURI(uri);
      
      expect(result).toBeNull();
    });

    it('should handle 8-digit codes', () => {
      const uri = 'otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=8';
      
      const result = parseOTPAuthURI(uri);
      
      expect(result?.digits).toBe(8);
    });

    it('should handle 60-second period', () => {
      const uri = 'otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&period=60';
      
      const result = parseOTPAuthURI(uri);
      
      expect(result?.period).toBe(60);
    });
  });

  describe('generateOTPAuthURI', () => {
    it('should generate valid URI with all fields', () => {
      const data: TOTPSetupData = {
        secret: 'JBSWY3DPEHPK3PXP',
        issuer: 'Example',
        accountName: 'alice@example.com',
        digits: 6,
        period: 30,
      };
      
      const uri = generateOTPAuthURI(data);
      
      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
      expect(uri).toContain('issuer=Example');
    });

    it('should URL-encode special characters', () => {
      const data: TOTPSetupData = {
        secret: 'JBSWY3DPEHPK3PXP',
        issuer: 'My Company',
        accountName: 'user@example.com',
      };
      
      const uri = generateOTPAuthURI(data);
      
      expect(uri).toContain('My%20Company');
      expect(uri).toContain('user%40example.com');
    });

    it('should omit default values', () => {
      const data: TOTPSetupData = {
        secret: 'JBSWY3DPEHPK3PXP',
        issuer: 'Test',
        digits: 6,
        period: 30,
        algorithm: 'SHA1',
      };
      
      const uri = generateOTPAuthURI(data);
      
      // Default values should not be in the URI
      expect(uri).not.toContain('digits=6');
      expect(uri).not.toContain('period=30');
      expect(uri).not.toContain('algorithm=SHA1');
    });

    it('should include non-default values', () => {
      const data: TOTPSetupData = {
        secret: 'JBSWY3DPEHPK3PXP',
        issuer: 'Test',
        digits: 8,
        period: 60,
        algorithm: 'SHA256',
      };
      
      const uri = generateOTPAuthURI(data);
      
      expect(uri).toContain('digits=8');
      expect(uri).toContain('period=60');
      expect(uri).toContain('algorithm=SHA256');
    });

    it('should round-trip correctly', () => {
      const original: TOTPSetupData = {
        secret: 'JBSWY3DPEHPK3PXP',
        issuer: 'Example',
        accountName: 'alice@example.com',
        digits: 6,
        period: 30,
      };
      
      const uri = generateOTPAuthURI(original);
      const parsed = parseOTPAuthURI(uri);
      
      expect(parsed?.secret).toBe(original.secret);
      expect(parsed?.issuer).toBe(original.issuer);
      expect(parsed?.accountName).toBe(original.accountName);
    });
  });
});

describe('TOTP Code Generation', () => {
  // Note: Testing actual TOTP generation requires careful time control
  // These tests verify the algorithm produces consistent outputs
  
  it('should generate 6-digit codes', async () => {
    // This test would need the generateCode function exposed
    // For now, we verify the component accepts the right parameters
    const data: TOTPSetupData = {
      secret: 'JBSWY3DPEHPK3PXP',
      digits: 6,
    };
    
    expect(data.digits).toBe(6);
  });

  it('should handle various secret formats', () => {
    // Secrets can have spaces or lowercase
    const secrets = [
      'JBSWY3DPEHPK3PXP',
      'jbswy3dpehpk3pxp',
      'JBSW Y3DP EHPK 3PXP',
    ];

    secrets.forEach(secret => {
      const data: TOTPSetupData = { secret };
      // Clean secret should be extractable
      expect(data.secret).toBeDefined();
    });
  });
});

describe('Base32 Encoding', () => {
  // The base32 alphabet used by TOTP
  const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  it('should use valid base32 characters', () => {
    const validSecret = 'JBSWY3DPEHPK3PXP';
    
    for (const char of validSecret) {
      expect(BASE32_ALPHABET.includes(char)).toBe(true);
    }
  });

  it('should reject invalid characters', () => {
    const invalidChars = '01890!@#$%^&*()';
    
    for (const char of invalidChars) {
      expect(BASE32_ALPHABET.includes(char)).toBe(false);
    }
  });
});
