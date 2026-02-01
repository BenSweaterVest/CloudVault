/**
 * TOTP Display Component
 * 
 * Generates and displays time-based one-time passwords (2FA codes).
 */

import { useState, useEffect, useCallback } from 'react';

interface TOTPDisplayProps {
  secret: string; // Base32 encoded secret
  issuer?: string;
  accountName?: string;
  digits?: number;
  period?: number;
  algorithm?: 'SHA-1' | 'SHA-256' | 'SHA-512';
  onCopy?: () => void;
}

export default function TOTPDisplay({
  secret,
  issuer,
  accountName,
  digits = 6,
  period = 30,
  algorithm = 'SHA-1',
  onCopy,
}: TOTPDisplayProps) {
  const [code, setCode] = useState<string>('------');
  const [timeRemaining, setTimeRemaining] = useState<number>(period);
  const [copied, setCopied] = useState(false);

  // Generate TOTP code
  const generateTOTP = useCallback(async () => {
    try {
      const counter = Math.floor(Date.now() / 1000 / period);
      const newCode = await generateCode(secret, counter, digits, algorithm);
      setCode(newCode);
    } catch (err) {
      console.error('TOTP generation error:', err);
      setCode('ERROR');
    }
  }, [secret, digits, period, algorithm]);

  // Update code and timer
  useEffect(() => {
    generateTOTP();
    
    const interval = setInterval(() => {
      const now = Date.now() / 1000;
      const remaining = period - (Math.floor(now) % period);
      setTimeRemaining(remaining);
      
      // Generate new code when period resets
      if (remaining === period) {
        generateTOTP();
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [generateTOTP, period]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error('Failed to copy');
    }
  };

  const progress = (timeRemaining / period) * 100;
  const isLow = timeRemaining <= 5;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          {issuer && (
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{issuer}</p>
          )}
          {accountName && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{accountName}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-8 h-8">
            <svg className="w-8 h-8 transform -rotate-90">
              <circle
                cx="16"
                cy="16"
                r="14"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                className="text-gray-200 dark:text-gray-700"
              />
              <circle
                cx="16"
                cy="16"
                r="14"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeDasharray={`${2 * Math.PI * 14}`}
                strokeDashoffset={`${2 * Math.PI * 14 * (1 - progress / 100)}`}
                className={`transition-all ${isLow ? 'text-red-500' : 'text-vault-500'}`}
              />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-xs font-medium ${
              isLow ? 'text-red-500' : 'text-gray-600 dark:text-gray-400'
            }`}>
              {timeRemaining}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <code className={`text-3xl font-mono font-bold tracking-wider ${
          isLow ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
        }`}>
          {code.slice(0, 3)} {code.slice(3)}
        </code>
        <button
          onClick={handleCopy}
          className={`p-2 rounded-lg transition-colors ${
            copied
              ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
          }`}
          title="Copy code"
        >
          {copied ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ============================================
// TOTP GENERATION HELPERS
// ============================================

/**
 * Generate a TOTP code
 */
async function generateCode(
  secret: string,
  counter: number,
  digits: number,
  algorithm: string
): Promise<string> {
  // Decode base32 secret
  const keyData = base32Decode(secret);
  
  // Import key
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: algorithm.replace('-', '') },
    false,
    ['sign']
  );
  
  // Create counter buffer (8 bytes, big-endian)
  const counterBuffer = new ArrayBuffer(8);
  const counterView = new DataView(counterBuffer);
  counterView.setBigUint64(0, BigInt(counter));
  
  // Generate HMAC
  const signature = await crypto.subtle.sign('HMAC', key, counterBuffer);
  const signatureArray = new Uint8Array(signature);
  
  // Dynamic truncation
  const offset = signatureArray[signatureArray.length - 1] & 0x0f;
  const binary =
    ((signatureArray[offset] & 0x7f) << 24) |
    ((signatureArray[offset + 1] & 0xff) << 16) |
    ((signatureArray[offset + 2] & 0xff) << 8) |
    (signatureArray[offset + 3] & 0xff);
  
  // Generate OTP
  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

/**
 * Decode base32 string to Uint8Array
 */
function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanInput = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  
  const bits: number[] = [];
  for (const char of cleanInput) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    for (let i = 4; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  }
  
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i + j];
    }
    bytes.push(byte);
  }
  
  return new Uint8Array(bytes);
}

// ============================================
// TOTP SETUP HELPER
// ============================================

export interface TOTPSetupData {
  secret: string;
  issuer?: string;
  accountName?: string;
  digits?: number;
  period?: number;
  algorithm?: string;
}

/**
 * Parse otpauth:// URI
 */
export function parseOTPAuthURI(uri: string): TOTPSetupData | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'otpauth:') return null;
    
    const type = url.hostname;
    if (type !== 'totp') return null;
    
    const label = decodeURIComponent(url.pathname.slice(1));
    const [issuer, accountName] = label.includes(':') 
      ? label.split(':').map(s => s.trim())
      : [undefined, label];
    
    const params = url.searchParams;
    
    return {
      secret: params.get('secret') || '',
      issuer: params.get('issuer') || issuer,
      accountName,
      digits: parseInt(params.get('digits') || '6'),
      period: parseInt(params.get('period') || '30'),
      algorithm: params.get('algorithm') || 'SHA1',
    };
  } catch {
    return null;
  }
}

/**
 * Generate otpauth:// URI
 */
export function generateOTPAuthURI(data: TOTPSetupData): string {
  const label = data.issuer 
    ? `${encodeURIComponent(data.issuer)}:${encodeURIComponent(data.accountName || '')}`
    : encodeURIComponent(data.accountName || '');
  
  const params = new URLSearchParams();
  params.set('secret', data.secret);
  if (data.issuer) params.set('issuer', data.issuer);
  if (data.digits && data.digits !== 6) params.set('digits', data.digits.toString());
  if (data.period && data.period !== 30) params.set('period', data.period.toString());
  if (data.algorithm && data.algorithm !== 'SHA1') params.set('algorithm', data.algorithm);
  
  return `otpauth://totp/${label}?${params.toString()}`;
}
