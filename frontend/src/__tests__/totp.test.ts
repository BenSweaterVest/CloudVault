// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { base32Decode, generateTotp, parseTotp } from '../lib/totp';

// RFC 6238 Appendix B test vectors (8 digits).
const SHA1_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
const SHA256_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA'; // 32 bytes

describe('TOTP', () => {
  it('decodes base32', () => {
    expect(new TextDecoder().decode(base32Decode(SHA1_SECRET))).toBe('12345678901234567890');
    expect(() => base32Decode('not base32!')).toThrow();
  });

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('matches RFC 6238 SHA-1 vector at t=%i', async (t, expected) => {
    const { code } = await generateTotp({ secret: SHA1_SECRET, digits: 8, period: 30, algorithm: 'SHA-1' }, t * 1000);
    expect(code).toBe(expected);
  });

  it('matches the RFC 6238 SHA-256 vector', async () => {
    const { code } = await generateTotp({ secret: SHA256_SECRET, digits: 8, period: 30, algorithm: 'SHA-256' }, 59_000);
    expect(code).toBe('46119246');
  });

  it('reports seconds remaining in the period', async () => {
    const { remaining } = await generateTotp({ secret: SHA1_SECRET, digits: 6, period: 30, algorithm: 'SHA-1' }, 59_000);
    expect(remaining).toBe(1);
  });

  it('parses otpauth URIs, including the SHA1 spelling used by most sites', () => {
    const cfg = parseTotp('otpauth://totp/ACME%20Co:jane@example.org?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA1&digits=6&period=30');
    expect(cfg).toMatchObject({ secret: 'JBSWY3DPEHPK3PXP', issuer: 'ACME Co', accountName: 'jane@example.org', algorithm: 'SHA-1', digits: 6, period: 30 });
    expect(parseTotp('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256')?.algorithm).toBe('SHA-256');
  });

  it('accepts bare secrets with spaces and rejects junk', () => {
    expect(parseTotp('jbsw y3dp ehpk 3pxp')).toMatchObject({ digits: 6, period: 30 });
    expect(parseTotp('not base32: 0189!')).toBeNull();
    expect(parseTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP')).toBeNull();
    expect(parseTotp('')).toBeNull();
  });
});
