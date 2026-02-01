/**
 * CloudVault Crypto Library
 * 
 * Zero-knowledge encryption using Web Crypto API.
 * All encryption/decryption happens in the browser - the server never sees plaintext.
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export interface ExportedKeyPair {
  publicKey: string;  // PEM format for server storage
  encryptedPrivateKey: string;  // Encrypted with master password
  salt: string;  // For key derivation
}

export interface EncryptedData {
  ciphertext: string;  // Hex encoded
  iv: string;  // Hex encoded
}

// ============================================
// CONSTANTS
// ============================================

const PBKDF2_ITERATIONS = 100000;
const AES_KEY_LENGTH = 256;
const RSA_KEY_LENGTH = 2048;
const IV_LENGTH = 12;  // 96 bits for AES-GCM

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Convert ArrayBuffer to hex string
 */
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to ArrayBuffer
 */
export function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

/**
 * Convert ArrayBuffer to Base64
 */
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 to ArrayBuffer
 */
export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generate cryptographically secure random bytes
 */
function generateRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

// ============================================
// KEY DERIVATION (Master Password → Encryption Key)
// ============================================

/**
 * Derive an AES key from master password using PBKDF2
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  // Import password as raw key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  // Derive AES key from password
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

// ============================================
// RSA KEY PAIR (User Identity)
// ============================================

/**
 * Generate a new RSA-OAEP key pair for user identity
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: RSA_KEY_LENGTH,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,  // extractable
    ['encrypt', 'decrypt']
  );

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  };
}

/**
 * Export public key to SPKI format (for server storage)
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('spki', publicKey);
  return bufferToBase64(exported);
}

/**
 * Import public key from SPKI format
 */
export async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  const keyBuffer = base64ToBuffer(publicKeyBase64);
  return crypto.subtle.importKey(
    'spki',
    keyBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );
}

/**
 * Export private key encrypted with master password
 */
export async function exportEncryptedPrivateKey(
  privateKey: CryptoKey,
  masterPassword: string
): Promise<{ encryptedKey: string; salt: string }> {
  // Export raw private key
  const rawKey = await crypto.subtle.exportKey('pkcs8', privateKey);
  
  // Generate salt for password derivation
  const salt = generateRandomBytes(16);
  
  // Derive encryption key from master password
  const derivedKey = await deriveKeyFromPassword(masterPassword, salt);
  
  // Generate IV
  const iv = generateRandomBytes(IV_LENGTH);
  
  // Encrypt the private key
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    rawKey
  );
  
  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encryptedBuffer), iv.length);
  
  return {
    encryptedKey: bufferToBase64(combined.buffer),
    salt: bufferToBase64(salt.buffer),
  };
}

/**
 * Import and decrypt private key using master password
 */
export async function importEncryptedPrivateKey(
  encryptedKeyBase64: string,
  saltBase64: string,
  masterPassword: string
): Promise<CryptoKey> {
  const combined = new Uint8Array(base64ToBuffer(encryptedKeyBase64));
  const salt = new Uint8Array(base64ToBuffer(saltBase64));
  
  // Extract IV and ciphertext
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  
  // Derive decryption key from master password
  const derivedKey = await deriveKeyFromPassword(masterPassword, salt);
  
  // Decrypt the private key
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    ciphertext
  );
  
  // Import the private key
  return crypto.subtle.importKey(
    'pkcs8',
    decryptedBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  );
}

// ============================================
// AES KEY (Organization Key)
// ============================================

/**
 * Generate a new AES-256-GCM key for organization vault
 */
export async function generateOrgKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    true,  // extractable (needed for sharing)
    ['encrypt', 'decrypt']
  );
}

/**
 * Export org key encrypted with user's public key (for key sharing)
 */
export async function encryptOrgKeyForUser(
  orgKey: CryptoKey,
  userPublicKey: CryptoKey
): Promise<string> {
  // Export raw AES key
  const rawOrgKey = await crypto.subtle.exportKey('raw', orgKey);
  
  // Encrypt with user's public key
  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    userPublicKey,
    rawOrgKey
  );
  
  return bufferToBase64(encrypted);
}

/**
 * Decrypt org key using user's private key
 */
export async function decryptOrgKey(
  encryptedOrgKeyBase64: string,
  userPrivateKey: CryptoKey
): Promise<CryptoKey> {
  const encryptedBuffer = base64ToBuffer(encryptedOrgKeyBase64);
  
  // Decrypt with user's private key
  const rawOrgKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    userPrivateKey,
    encryptedBuffer
  );
  
  // Import as AES key
  return crypto.subtle.importKey(
    'raw',
    rawOrgKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

// ============================================
// SECRET ENCRYPTION (The Main Feature)
// ============================================

export interface SecretData {
  username: string;
  password: string;
  notes?: string;
}

/**
 * Encrypt a secret using the organization's AES key
 */
export async function encryptSecret(
  data: SecretData,
  orgKey: CryptoKey
): Promise<EncryptedData> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));
  
  // Generate unique IV for this encryption
  const iv = generateRandomBytes(IV_LENGTH);
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    orgKey,
    plaintext
  );
  
  return {
    ciphertext: bufferToHex(ciphertext),
    iv: bufferToHex(iv.buffer),
  };
}

/**
 * Decrypt a secret using the organization's AES key
 */
export async function decryptSecret(
  encryptedData: EncryptedData,
  orgKey: CryptoKey
): Promise<SecretData> {
  const iv = new Uint8Array(hexToBuffer(encryptedData.iv));
  const ciphertext = hexToBuffer(encryptedData.ciphertext);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    orgKey,
    ciphertext
  );
  
  const decoder = new TextDecoder();
  const json = decoder.decode(decrypted);
  return JSON.parse(json);
}

// ============================================
// KEY PAIR SETUP FLOW
// ============================================

/**
 * Complete setup for a new user: generate keys, encrypt private key
 */
export async function setupUserKeys(
  masterPassword: string
): Promise<ExportedKeyPair> {
  // Generate RSA key pair
  const keyPair = await generateKeyPair();
  
  // Export public key for server storage
  const publicKey = await exportPublicKey(keyPair.publicKey);
  
  // Export private key encrypted with master password
  const { encryptedKey, salt } = await exportEncryptedPrivateKey(
    keyPair.privateKey,
    masterPassword
  );
  
  return {
    publicKey,
    encryptedPrivateKey: encryptedKey,
    salt,
  };
}

/**
 * Unlock user's private key using master password
 */
export async function unlockPrivateKey(
  encryptedPrivateKey: string,
  salt: string,
  masterPassword: string
): Promise<CryptoKey> {
  return importEncryptedPrivateKey(encryptedPrivateKey, salt, masterPassword);
}

// ============================================
// ORGANIZATION SETUP FLOW
// ============================================

/**
 * Create a new organization: generate org key, encrypt for creator
 */
export async function createOrganizationKeys(
  creatorPublicKey: CryptoKey
): Promise<{ orgKey: CryptoKey; encryptedOrgKey: string }> {
  // Generate new org key
  const orgKey = await generateOrgKey();
  
  // Encrypt for the creator
  const encryptedOrgKey = await encryptOrgKeyForUser(orgKey, creatorPublicKey);
  
  return { orgKey, encryptedOrgKey };
}

/**
 * Grant a new user access to an organization
 * (Run in admin's browser who has the org key)
 */
export async function grantOrgAccess(
  orgKey: CryptoKey,
  newUserPublicKeyBase64: string
): Promise<string> {
  const newUserPublicKey = await importPublicKey(newUserPublicKeyBase64);
  return encryptOrgKeyForUser(orgKey, newUserPublicKey);
}
