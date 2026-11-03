/**
 * Request validation schemas (Zod).
 *
 * Every route that reads a body or query string validates it here. Size
 * limits keep a single request well inside the Workers free plan budget.
 */

import { z } from 'zod';
import type { Context } from 'hono';
import { AUDIT_ACTIONS } from '../middleware/audit';

// ============================================
// PRIMITIVES
// ============================================

export const uuidSchema = z.string().uuid();
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const roleSchema = z.enum(['admin', 'member', 'read_only']);

/** Base64 (standard alphabet, padded) */
const base64 = (max: number) =>
  z.string().min(1).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be base64');

/** Lowercase hex */
const hex = (max: number) =>
  z.string().min(1).max(max).regex(/^[0-9a-f]+$/, 'Must be lowercase hex');

/** AES-GCM IV: 12 bytes as hex */
export const ivSchema = z.string().regex(/^[0-9a-f]{24}$/, 'IV must be 12 bytes of hex');

/** Encrypted payload: up to ~128 KB of ciphertext */
export const ciphertextSchema = hex(262_144);

/** RSA-OAEP encrypted org key (base64) */
export const encryptedOrgKeySchema = base64(2048);

/** Secret encryption format. 1 = legacy, 2 = bound with associated data. */
export const encVersionSchema = z.union([z.literal(1), z.literal(2)]);

/** http(s) URL or empty string. Other schemes (javascript:, data:) are rejected. */
export const webUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (value === '') return true;
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'URL must start with http:// or https://');

export const kdfIterationsSchema = z.number().int().min(100_000).max(10_000_000);

// ============================================
// AUTH
// ============================================

export const githubCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required').max(512),
});

export const magicLinkRequestSchema = z.object({
  email: emailSchema,
});

export const magicLinkVerifySchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'Invalid token format'),
});

export const setupKeysSchema = z.object({
  publicKey: base64(4096),
  encryptedPrivateKey: base64(16_384),
  salt: base64(128),
  kdfIterations: kdfIterationsSchema.optional().default(100_000),
});

export const changeMasterPasswordSchema = z.object({
  encryptedPrivateKey: base64(16_384),
  salt: base64(128),
  kdfIterations: kdfIterationsSchema,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).nullable(),
});

// ============================================
// ORGANIZATIONS AND MEMBERS
// ============================================

export const orgNameSchema = z.string().trim().min(1, 'Name is required').max(100, 'Name too long');

export const createOrgSchema = z.object({
  name: orgNameSchema,
  encryptedOrgKey: encryptedOrgKeySchema,
});

export const updateOrgSchema = z.object({
  name: orgNameSchema,
});

export const inviteUserSchema = z.object({
  email: emailSchema,
  role: roleSchema.optional().default('member'),
});

export const approveUserSchema = z.object({
  encryptedOrgKey: encryptedOrgKeySchema,
});

export const updateRoleSchema = z.object({
  role: roleSchema,
});

// ============================================
// SECRETS
// ============================================

export const secretTypeSchema = z.enum(['password', 'note', 'api_key', 'card', 'totp']);

const tagsSchema = z.array(z.string().trim().min(1).max(50)).max(20);

export const createSecretSchema = z.object({
  /** Client-generated id, required for encVersion 2 (it is bound into the ciphertext). */
  id: uuidSchema.optional(),
  name: z.string().trim().min(1, 'Name is required').max(200, 'Name too long'),
  url: webUrlSchema.optional(),
  usernameHint: z.string().max(200).optional(),
  ciphertextBlob: ciphertextSchema,
  iv: ivSchema,
  encVersion: encVersionSchema.optional().default(1),
  categoryId: uuidSchema.optional().nullable(),
  secretType: secretTypeSchema.optional().default('password'),
  tags: tagsSchema.optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export const updateSecretSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    url: webUrlSchema.optional(),
    usernameHint: z.string().max(200).optional(),
    ciphertextBlob: ciphertextSchema.optional(),
    iv: ivSchema.optional(),
    encVersion: encVersionSchema.optional(),
    categoryId: uuidSchema.optional().nullable(),
    secretType: secretTypeSchema.optional(),
    tags: tagsSchema.optional(),
    expiresAt: z.string().datetime().optional().nullable(),
    /** Version the client edited. If set and stale, the update is rejected (409). */
    expectedVersion: z.number().int().min(1).optional(),
  })
  .refine((d) => (d.ciphertextBlob === undefined) === (d.iv === undefined), {
    message: 'ciphertextBlob and iv must be updated together',
  });

export const toggleFavoriteSchema = z.object({
  isFavorite: z.boolean(),
});

export const importSecretsSchema = z.object({
  secrets: z.array(createSecretSchema).min(1, 'No secrets to import').max(500, 'Import limit is 500 secrets per request'),
  categoryId: uuidSchema.optional().nullable(),
});

// ============================================
// CATEGORIES
// ============================================

const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format');
const iconSchema = z.string().regex(/^[a-z0-9-]{1,50}$/, 'Invalid icon');

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(50, 'Name too long'),
  icon: iconSchema.optional().default('folder'),
  color: colorSchema.optional().default('#6366f1'),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  icon: iconSchema.optional(),
  color: colorSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

// ============================================
// PREFERENCES AND ORG SETTINGS
// ============================================

export const updatePreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  sessionTimeout: z.number().int().min(0).max(1440).optional(), // minutes, 0 = never
  clipboardClear: z.number().int().min(0).max(300).optional(), // seconds, 0 = never
  showFavicons: z.boolean().optional(),
  compactView: z.boolean().optional(),
});

export const updateOrgSettingsSchema = z.object({
  minPasswordLength: z.number().int().min(8).max(128).optional(),
  passwordExpiryDays: z.number().int().min(0).max(730).optional(),
  allowShareLinks: z.boolean().optional(),
  shareLinkMaxHours: z.number().int().min(1).max(720).optional(),
  allowEmergencyAccess: z.boolean().optional(),
  emergencyWaitMinHours: z.number().int().min(1).max(720).optional(),
  auditRetentionDays: z.number().int().min(30).max(3650).optional(),
});

// ============================================
// SHARING
// ============================================

export const createShareLinkSchema = z
  .object({
    /** Client-generated id, bound into the share ciphertext */
    id: uuidSchema,
    ciphertextBlob: ciphertextSchema,
    iv: ivSchema,
    expiresInHours: z.number().int().min(1).max(720),
    maxViews: z.number().int().min(0).max(100).default(1), // 0 = unlimited
    allowCopy: z.boolean().default(true),
    recipientEmail: emailSchema.optional(),
    /** Optional password gate: salt and SHA-256 of a client-derived token (hex) */
    accessSalt: base64(64).optional(),
    accessVerifier: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .refine((d) => (d.accessSalt === undefined) === (d.accessVerifier === undefined), {
    message: 'accessSalt and accessVerifier must be provided together',
  });

export const accessShareLinkSchema = z.object({
  /** Client-derived access token (hex). Required when the link has a password. */
  accessToken: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

// ============================================
// EMERGENCY ACCESS
// ============================================

export const addEmergencyContactSchema = z.object({
  contactEmail: emailSchema,
  contactName: z.string().trim().min(1).max(100).optional(),
  waitTimeHours: z.number().int().min(1).max(720),
  /** Org key encrypted for the contact's public key */
  encryptedOrgKey: encryptedOrgKeySchema,
});

export const requestEmergencyAccessSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});

// ============================================
// KEY ROTATION
// ============================================

export const rotateOrgKeySchema = z.object({
  /** The key version the client rotated from (optimistic concurrency) */
  fromKeyVersion: z.number().int().min(1),
  secrets: z
    .array(z.object({ id: uuidSchema, ciphertextBlob: ciphertextSchema, iv: ivSchema, encVersion: encVersionSchema }))
    .max(2000),
  history: z
    .array(z.object({ id: z.number().int(), ciphertextBlob: ciphertextSchema, iv: ivSchema, encVersion: encVersionSchema }))
    .max(10_000),
  memberKeys: z.array(z.object({ userId: uuidSchema, encryptedOrgKey: encryptedOrgKeySchema })).min(1).max(1000),
  emergencyKeys: z
    .array(z.object({ contactId: uuidSchema, encryptedOrgKey: encryptedOrgKeySchema }))
    .max(1000)
    .default([]),
});

// ============================================
// AUDIT
// ============================================

export const auditActionSchema = z.enum(AUDIT_ACTIONS);

export const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  action: auditActionSchema.optional(),
  userId: uuidSchema.optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// ============================================
// HELPERS
// ============================================

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((e) => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message))
    .join(', ');
}

/** Parse and validate a JSON body. Throws ValidationError (400). */
export async function validateBody<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new ValidationError(formatZodError(result.error));
  return result.data;
}

/** Validate query parameters. Throws ValidationError (400). */
export function validateQuery<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const result = schema.safeParse(query);
  if (!result.success) throw new ValidationError(formatZodError(result.error));
  return result.data;
}
