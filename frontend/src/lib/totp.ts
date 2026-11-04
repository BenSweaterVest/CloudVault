/**
 * TOTP (RFC 6238) code generation with Web Crypto.
 *
 * Accepts either an otpauth://totp/... URI or a bare base32 secret.
 */

export interface TotpConfig {
  secret: string;
  issuer?: string;
  accountName?: string;
  digits: number;
  period: number;
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512';
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  if (!/^[A-Z2-7]+$/.test(clean)) throw new Error('Invalid base32 secret');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function normalizeAlgorithm(value: string | null | undefined): TotpConfig['algorithm'] {
  const v = (value ?? 'SHA1').toUpperCase().replace('-', '');
  if (v === 'SHA256') return 'SHA-256';
  if (v === 'SHA512') return 'SHA-512';
  return 'SHA-1';
}

/** Parse an otpauth URI or base32 secret. Returns null if unusable. */
export function parseTotp(input: string): TotpConfig | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    try {
      const url = new URL(trimmed);
      if (url.host.toLowerCase() !== 'totp') return null;
      const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const [labelIssuer, account] = label.includes(':') ? label.split(':', 2).map((s) => s.trim()) : [undefined, label];
      const secret = url.searchParams.get('secret') ?? '';
      base32Decode(secret);
      const digits = parseInt(url.searchParams.get('digits') ?? '6', 10);
      const period = parseInt(url.searchParams.get('period') ?? '30', 10);
      return {
        secret,
        issuer: url.searchParams.get('issuer') ?? labelIssuer,
        accountName: account || undefined,
        digits: digits >= 6 && digits <= 10 ? digits : 6,
        period: period > 0 && period <= 300 ? period : 30,
        algorithm: normalizeAlgorithm(url.searchParams.get('algorithm')),
      };
    } catch {
      return null;
    }
  }

  try {
    base32Decode(trimmed);
    return { secret: trimmed, digits: 6, period: 30, algorithm: 'SHA-1' };
  } catch {
    return null;
  }
}

/** Generate the code for `time` (ms since epoch). */
export async function generateTotp(config: TotpConfig, time = Date.now()): Promise<{ code: string; remaining: number }> {
  const counter = Math.floor(time / 1000 / config.period);
  const key = await crypto.subtle.importKey('raw', base32Decode(config.secret), { name: 'HMAC', hash: config.algorithm }, false, ['sign']);
  const counterBytes = new ArrayBuffer(8);
  new DataView(counterBytes).setBigUint64(0, BigInt(counter));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));

  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) | ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
  const code = (binary % 10 ** config.digits).toString().padStart(config.digits, '0');
  const remaining = config.period - (Math.floor(time / 1000) % config.period);
  return { code, remaining };
}
