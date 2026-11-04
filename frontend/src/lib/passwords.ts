/**
 * Password generation and strength estimation.
 *
 * Generation uses crypto.getRandomValues with rejection sampling, so every
 * character is uniformly chosen (no modulo bias) and Math.random is never used.
 */

export interface GeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
};

const SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
};
const AMBIGUOUS = /[Il1O0o]/g;

/** Uniform random integer in [0, max). */
export function randomInt(max: number): number {
  if (max <= 0 || max > 2 ** 32) throw new Error('Invalid range');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)];
}

/** Character sets enabled by the options (ambiguous characters removed if asked). */
export function enabledSets(options: GeneratorOptions): string[] {
  const keys = (['uppercase', 'lowercase', 'numbers', 'symbols'] as const).filter((k) => options[k]);
  return keys.map((k) => (options.excludeAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]));
}

/**
 * Generate a password with at least one character from each enabled set.
 */
export function generatePassword(options: GeneratorOptions): string {
  const sets = enabledSets(options);
  if (sets.length === 0) return '';
  const length = Math.max(options.length, sets.length);
  const all = sets.join('');

  const chars = sets.map(pick);
  while (chars.length < length) chars.push(pick(all));

  // Fisher-Yates shuffle so the guaranteed characters are not at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ============================================
// STRENGTH
// ============================================

const COMMON = [
  'password', 'passw0rd', '123456', '12345678', 'qwerty', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey',
  'dragon', 'football', 'baseball', 'abc123', 'trustno1', 'sunshine', 'princess', 'master', 'login', 'changeme',
];

export interface StrengthResult {
  /** 0 (very weak) to 4 (very strong) */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  entropyBits: number;
  feedback: string | null;
  barClass: string;
}

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
const BAR_CLASSES = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-lime-500', 'bg-green-500'];

/**
 * Rough entropy estimate: character pool size times length, reduced for
 * repeated characters, sequences and common passwords. Good enough to steer
 * people away from weak choices; not a substitute for a real cracker model.
 */
export function assessPassword(password: string): StrengthResult {
  if (!password) return { score: 0, label: LABELS[0], entropyBits: 0, feedback: null, barClass: BAR_CLASSES[0] };

  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(password)) pool += 33;

  const unique = new Set(password).size;
  const effectiveLength = Math.min(password.length, unique * 2);
  let entropy = effectiveLength * Math.log2(Math.max(pool, 1));

  let feedback: string | null = null;
  const lower = password.toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) {
    entropy = Math.min(entropy, 20);
    feedback = 'Avoid common passwords and words like "password"';
  } else if (/(.)\1{2,}/.test(password)) {
    entropy *= 0.75;
    feedback = 'Avoid repeated characters';
  } else if (/(?:0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf)/i.test(password)) {
    entropy *= 0.8;
    feedback = 'Avoid sequences like 1234 or abcd';
  } else if (password.length < 12) {
    feedback = 'Use at least 12 characters';
  }

  const score = (entropy < 28 ? 0 : entropy < 45 ? 1 : entropy < 60 ? 2 : entropy < 80 ? 3 : 4) as StrengthResult['score'];
  if (!feedback && score < 3) feedback = 'Make it longer, or mix in more kinds of characters';
  return { score, label: LABELS[score], entropyBits: Math.round(entropy), feedback, barClass: BAR_CLASSES[score] };
}

/** Same scale, used for the master password meter (4 bars). */
export function assessMasterPassword(password: string): StrengthResult {
  return assessPassword(password);
}
