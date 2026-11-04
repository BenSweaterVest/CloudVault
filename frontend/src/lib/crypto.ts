/**
 * CloudVault cryptography (browser only, Web Crypto API, no dependencies).
 *
 * Key hierarchy
 *   master password --PBKDF2-SHA256--> wrapping key (AES-256-GCM)
 *   wrapping key encrypts the user's RSA-OAEP private key (stored on server)
 *   RSA-OAEP public key encrypts each org's AES-256-GCM key (one copy per member)
 *   org key encrypts secrets
 *
 * Secret formats (encVersion)
 *   1: AES-GCM, no associated data (legacy, still readable)
 *   2: AES-GCM with associated data "cloudvault:secret:v2:<orgId>:<secretId>",
 *      so the server cannot move ciphertext between secrets or orgs undetected.
 *      All new writes use version 2.
 *
 * Share links use a random one-off AES key carried in the URL fragment.
 */

// ============================================
// CONSTANTS
// ============================================

/** PBKDF2 iterations for new keys (OWASP 2023 guidance for PBKDF2-SHA256). */
export const CURRENT_KDF_ITERATIONS = 600_000;
/** Iterations used by accounts created before per-user iteration counts. */
export const LEGACY_KDF_ITERATIONS = 100_000;
/** RSA modulus for new key pairs. Existing 2048-bit keys keep working. */
export const RSA_MODULUS_BITS = 3072;
/** PBKDF2 iterations for share link passwords (runs in the browser). */
const SHARE_PASSWORD_ITERATIONS = 300_000;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

export const CURRENT_SECRET_FORMAT = 2;

// ============================================
// ENCODING
// ============================================

export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error('Invalid hex');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bufferToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Random URL-safe string (for OAuth state and similar nonces). */
export function randomToken(bytes = 32): string {
  return bytesToBase64Url(randomBytes(bytes));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function sha256Hex(value: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const data = typeof value === 'string' ? encoder.encode(value) : value;
  return bufferToHex(await crypto.subtle.digest('SHA-256', data));
}

// ============================================
// MASTER PASSWORD
// ============================================

/** Derive the AES key that wraps the private key. */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number = CURRENT_KDF_ITERATIONS
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ============================================
// USER KEY PAIR
// ============================================

const RSA_PARAMS = { name: 'RSA-OAEP', hash: 'SHA-256' } as const;

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { ...RSA_PARAMS, modulusLength: RSA_MODULUS_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  return bufferToBase64(await crypto.subtle.exportKey('spki', publicKey));
}

export async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', base64ToBytes(publicKeyBase64), RSA_PARAMS, true, ['encrypt']);
}

export interface WrappedPrivateKey {
  encryptedPrivateKey: string;
  salt: string;
  kdfIterations: number;
}

/** Encrypt a private key under a master password (fresh salt each time). */
export async function wrapPrivateKey(
  privateKey: CryptoKey,
  masterPassword: string,
  iterations: number = CURRENT_KDF_ITERATIONS
): Promise<WrappedPrivateKey> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const wrappingKey = await deriveKeyFromPassword(masterPassword, salt, iterations);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, pkcs8));

  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);
  return { encryptedPrivateKey: bufferToBase64(combined), salt: bufferToBase64(salt), kdfIterations: iterations };
}

/**
 * Decrypt the private key with the master password.
 * Throws if the password is wrong (AES-GCM authentication fails).
 */
export async function unwrapPrivateKey(
  encryptedPrivateKey: string,
  saltBase64: string,
  masterPassword: string,
  iterations: number = LEGACY_KDF_ITERATIONS
): Promise<CryptoKey> {
  const combined = base64ToBytes(encryptedPrivateKey);
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const wrappingKey = await deriveKeyFromPassword(masterPassword, base64ToBytes(saltBase64), iterations);
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, ciphertext);
  // Extractable so the key can be re-wrapped when the master password changes.
  return crypto.subtle.importKey('pkcs8', pkcs8, RSA_PARAMS, true, ['decrypt']);
}

/** New user: generate a key pair and wrap the private key. */
export async function setupUserKeys(masterPassword: string): Promise<WrappedPrivateKey & { publicKey: string }> {
  const pair = await generateKeyPair();
  const [publicKey, wrapped] = await Promise.all([exportPublicKey(pair.publicKey), wrapPrivateKey(pair.privateKey, masterPassword)]);
  return { publicKey, ...wrapped };
}

/**
 * Compute the public key from the private key, without trusting the server's
 * copy. Used to show the user their own fingerprint.
 */
export async function publicKeyFromPrivateKey(privateKey: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, ext: true },
    RSA_PARAMS,
    true,
    ['encrypt']
  );
  return exportPublicKey(publicKey);
}

/**
 * Human-comparable fingerprint of a public key: the first 16 bytes of
 * SHA-256(SPKI) as eight groups of four hex digits.
 *
 * Admins compare this with the fingerprint the new member reads from their
 * own device before approving, so a compromised server cannot substitute
 * its own key and receive the org key.
 */
export async function keyFingerprint(publicKeyBase64: string): Promise<string> {
  const hex = (await sha256Hex(base64ToBytes(publicKeyBase64))).slice(0, 32).toUpperCase();
  return hex.match(/.{4}/g)?.join(' ') ?? hex;
}

// ============================================
// ORG KEY
// ============================================

export async function generateOrgKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Encrypt an org key for a user's public key. */
export async function encryptOrgKeyFor(orgKey: CryptoKey, publicKey: CryptoKey | string): Promise<string> {
  const key = typeof publicKey === 'string' ? await importPublicKey(publicKey) : publicKey;
  const raw = await crypto.subtle.exportKey('raw', orgKey);
  return bufferToBase64(await crypto.subtle.encrypt(RSA_PARAMS, key, raw));
}

export async function decryptOrgKey(encryptedOrgKey: string, privateKey: CryptoKey): Promise<CryptoKey> {
  const raw = await crypto.subtle.decrypt(RSA_PARAMS, privateKey, base64ToBytes(encryptedOrgKey));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** New org: generate a key and encrypt it for the creator. */
export async function createOrganizationKeys(creatorPublicKey: string): Promise<{ orgKey: CryptoKey; encryptedOrgKey: string }> {
  const orgKey = await generateOrgKey();
  return { orgKey, encryptedOrgKey: await encryptOrgKeyFor(orgKey, creatorPublicKey) };
}

// ============================================
// SECRET PAYLOADS
// ============================================

export interface CustomField {
  label: string;
  value: string;
  hidden: boolean;
}

export interface CardDetails {
  holder?: string;
  number?: string;
  expiry?: string;
  cvv?: string;
  pin?: string;
}

/** Everything inside the encrypted blob. All fields optional by type. */
export interface SecretPayload {
  username?: string;
  password?: string;
  notes?: string;
  /** otpauth:// URI or base32 TOTP secret */
  totp?: string;
  apiKey?: string;
  card?: CardDetails;
  customFields?: CustomField[];
}

/** Accept older payload shapes (e.g. totpSecret) and drop unknown types. */
export function normalizePayload(raw: unknown): SecretPayload {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const card = r.card && typeof r.card === 'object' ? (r.card as Record<string, unknown>) : undefined;
  return {
    username: str(r.username),
    password: str(r.password),
    notes: str(r.notes),
    totp: str(r.totp) ?? str(r.totpSecret),
    apiKey: str(r.apiKey),
    card: card
      ? { holder: str(card.holder), number: str(card.number), expiry: str(card.expiry), cvv: str(card.cvv), pin: str(card.pin) }
      : undefined,
    customFields: Array.isArray(r.customFields)
      ? (r.customFields as Array<Record<string, unknown>>)
          .filter((f) => f && typeof f.label === 'string')
          .map((f) => ({ label: String(f.label), value: String(f.value ?? ''), hidden: !!f.hidden }))
      : undefined,
  };
}

export interface EncryptedBlob {
  ciphertext: string; // hex
  iv: string; // hex
}

async function aesEncrypt(data: Uint8Array<ArrayBuffer>, key: CryptoKey, aad?: string): Promise<EncryptedBlob> {
  const iv = randomBytes(IV_LENGTH);
  const params: AesGcmParams = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = encoder.encode(aad);
  const ciphertext = await crypto.subtle.encrypt(params, key, data);
  return { ciphertext: bufferToHex(ciphertext), iv: bufferToHex(iv) };
}

async function aesDecrypt(blob: EncryptedBlob, key: CryptoKey, aad?: string): Promise<Uint8Array> {
  const params: AesGcmParams = { name: 'AES-GCM', iv: hexToBytes(blob.iv) };
  if (aad) params.additionalData = encoder.encode(aad);
  return new Uint8Array(await crypto.subtle.decrypt(params, key, hexToBytes(blob.ciphertext)));
}

export function secretAad(orgId: string, secretId: string): string {
  return `cloudvault:secret:v2:${orgId}:${secretId}`;
}

export interface EncryptedSecret {
  ciphertextBlob: string;
  iv: string;
  encVersion: 1 | 2;
}

/** Encrypt a payload for a secret (always the current format). */
export async function encryptSecretPayload(
  payload: SecretPayload,
  orgKey: CryptoKey,
  orgId: string,
  secretId: string
): Promise<EncryptedSecret> {
  const blob = await aesEncrypt(encoder.encode(JSON.stringify(payload)), orgKey, secretAad(orgId, secretId));
  return { ciphertextBlob: blob.ciphertext, iv: blob.iv, encVersion: 2 };
}

/** Decrypt a secret in either format. */
export async function decryptSecretPayload(
  secret: { ciphertextBlob: string; iv: string; encVersion?: number },
  orgKey: CryptoKey,
  orgId: string,
  secretId: string
): Promise<SecretPayload> {
  const aad = secret.encVersion === 2 ? secretAad(orgId, secretId) : undefined;
  const plaintext = await aesDecrypt({ ciphertext: secret.ciphertextBlob, iv: secret.iv }, orgKey, aad);
  return normalizePayload(JSON.parse(decoder.decode(plaintext)));
}

// ============================================
// SHARE LINKS
// ============================================

function shareAad(linkId: string): string {
  return `cloudvault:share:v1:${linkId}`;
}

export interface SharePackage {
  ciphertextBlob: string;
  iv: string;
  /** base64url key for the URL fragment */
  fragmentKey: string;
}

/** Encrypt a payload with a fresh one-off key for a share link. */
export async function createSharePackage(payload: SecretPayload, linkId: string): Promise<SharePackage> {
  const raw = randomBytes(32);
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const blob = await aesEncrypt(encoder.encode(JSON.stringify(payload)), key, shareAad(linkId));
  return { ciphertextBlob: blob.ciphertext, iv: blob.iv, fragmentKey: bytesToBase64Url(raw) };
}

export async function openSharePackage(
  share: { ciphertextBlob: string; iv: string },
  fragmentKey: string,
  linkId: string
): Promise<SecretPayload> {
  const raw = base64UrlToBytes(fragmentKey);
  if (raw.length !== 32) throw new Error('Invalid share key');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await aesDecrypt({ ciphertext: share.ciphertextBlob, iv: share.iv }, key, shareAad(linkId));
  return normalizePayload(JSON.parse(decoder.decode(plaintext)));
}

/**
 * Derive the access token for a password-protected share link. The server
 * only stores SHA-256(token), so it never sees the password and does no
 * slow hashing itself.
 */
export async function deriveShareAccessToken(password: string, saltBase64: string): Promise<string> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: base64ToBytes(saltBase64), iterations: SHARE_PASSWORD_ITERATIONS, hash: 'SHA-256' },
    material,
    256
  );
  return bufferToHex(bits);
}

/** Salt + verifier to send when creating a password-protected link. */
export async function createShareAccessVerifier(password: string): Promise<{ accessSalt: string; accessVerifier: string }> {
  const accessSalt = bufferToBase64(randomBytes(SALT_LENGTH));
  const token = await deriveShareAccessToken(password, accessSalt);
  return { accessSalt, accessVerifier: await sha256Hex(token) };
}
