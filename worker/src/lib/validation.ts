/**
 * Zod Validation Schemas
 * 
 * Centralized validation schemas for all API endpoints.
 * All schemas include custom error messages for better API responses.
 * 
 * @module lib/validation
 * 
 * @example
 * ```typescript
 * import { createSecretSchema, validateBody } from './validation';
 * 
 * app.post('/secrets', async (c) => {
 *   const data = await validateBody(c, createSecretSchema);
 *   // data is now typed and validated
 * });
 * ```
 */

import { z } from 'zod';

// ============================================
// COMMON SCHEMAS
// ============================================

/** UUID v4 format validation */
export const uuidSchema = z.string().uuid();

/** Email validation with automatic lowercase normalization */
export const emailSchema = z.string().email().toLowerCase();

/** Non-empty string with 1000 char max (for general text fields) */
export const nonEmptyString = z.string().min(1).max(1000);

// ============================================
// AUTH SCHEMAS
// ============================================

/**
 * GitHub OAuth callback validation
 * @property {string} code - GitHub authorization code from OAuth redirect
 */
export const githubCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
});

/**
 * Magic link request validation
 * @property {string} email - User's email address
 */
export const magicLinkRequestSchema = z.object({
  email: emailSchema,
});

/**
 * Magic link verification validation
 * @property {string} token - UUID token from magic link email
 */
export const magicLinkVerifySchema = z.object({
  token: z.string().uuid('Invalid token format'),
});

/**
 * User key setup validation (during first login)
 * @property {string} publicKey - Base64-encoded RSA public key
 * @property {string} encryptedPrivateKey - Encrypted RSA private key
 * @property {string} salt - PBKDF2 salt for key derivation
 */
export const setupKeysSchema = z.object({
  publicKey: z.string().min(1, 'Public key is required'),
  encryptedPrivateKey: z.string().min(1, 'Encrypted private key is required'),
  salt: z.string().min(1, 'Salt is required'),
});

// ============================================
// ORGANIZATION SCHEMAS
// ============================================

/**
 * Organization creation validation
 * @property {string} name - Organization display name (1-100 chars)
 * @property {string} encryptedOrgKey - AES key encrypted with creator's public key
 */
export const createOrgSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  encryptedOrgKey: z.string().min(1, 'Encrypted org key is required'),
});

/**
 * User invitation validation
 * @property {string} email - Email address to invite
 * @property {string} [role='member'] - Role to assign: 'admin', 'member', or 'read_only'
 */
export const inviteUserSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'member', 'read_only']).optional().default('member'),
});

/**
 * User approval validation (admin grants access)
 * @property {string} encryptedOrgKey - Org key encrypted with new user's public key
 */
export const approveUserSchema = z.object({
  encryptedOrgKey: z.string().min(1, 'Encrypted org key is required'),
});

/**
 * Role update validation
 * @property {string} role - New role: 'admin', 'member', or 'read_only'
 */
export const updateRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'read_only']),
});

// ============================================
// SECRET SCHEMAS
// ============================================

/**
 * Valid secret types
 * - password: Login credentials
 * - note: Secure text notes
 * - api_key: API keys and tokens
 * - card: Payment card information
 * - totp: Two-factor authentication codes
 */
export const secretTypeSchema = z.enum(['password', 'note', 'api_key', 'card', 'totp']);

/**
 * Secret creation validation
 * @property {string} name - Display name (1-200 chars)
 * @property {string} [url] - Associated URL (optional)
 * @property {string} [usernameHint] - Unencrypted username for search
 * @property {string} ciphertextBlob - AES-256-GCM encrypted data (base64)
 * @property {string} iv - Initialization vector (base64)
 * @property {string} [categoryId] - Category UUID (optional)
 * @property {string} [secretType='password'] - Type of secret
 * @property {string[]} [tags] - Tags for organization (max 10)
 * @property {string} [expiresAt] - ISO 8601 expiration date
 */
export const createSecretSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name too long'),
  url: z.string().url().optional().or(z.literal('')),
  usernameHint: z.string().max(200).optional(),
  ciphertextBlob: z.string().min(1, 'Encrypted data is required'),
  iv: z.string().min(1, 'IV is required'),
  categoryId: z.string().uuid().optional().nullable(),
  secretType: secretTypeSchema.optional().default('password'),
  tags: z.array(z.string().max(50)).max(10).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

/**
 * Secret update validation (all fields optional)
 * Same fields as createSecretSchema but all optional for partial updates.
 */
export const updateSecretSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  url: z.string().url().optional().or(z.literal('')),
  usernameHint: z.string().max(200).optional(),
  ciphertextBlob: z.string().min(1).optional(),
  iv: z.string().min(1).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  secretType: secretTypeSchema.optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
  isFavorite: z.boolean().optional(),
});

/**
 * Toggle favorite status
 * @property {boolean} isFavorite - Whether to mark as favorite
 */
export const toggleFavoriteSchema = z.object({
  isFavorite: z.boolean(),
});

// ============================================
// CATEGORY SCHEMAS
// ============================================

/**
 * Category creation validation
 * @property {string} name - Category name (1-50 chars)
 * @property {string} [icon='folder'] - Icon identifier
 * @property {string} [color='#6366f1'] - Hex color code
 */
export const createCategorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name too long'),
  icon: z.string().max(50).optional().default('folder'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format').optional().default('#6366f1'),
});

/**
 * Category update validation (all fields optional)
 * @property {string} [name] - Category name
 * @property {string} [icon] - Icon identifier
 * @property {string} [color] - Hex color code
 * @property {number} [sortOrder] - Display order (0+)
 */
export const updateCategorySchema = z.object({
  name: z.string().min(1).max(50).optional(),
  icon: z.string().max(50).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

// ============================================
// USER PREFERENCES SCHEMAS
// ============================================

/**
 * User preferences update validation
 * @property {string} [theme] - UI theme: 'light', 'dark', or 'system'
 * @property {number} [sessionTimeout] - Minutes until auto-lock (0=never, 1-120)
 * @property {number} [clipboardClear] - Seconds until clipboard clear (0-300, 0=disabled)
 * @property {boolean} [showFavicons] - Show website favicons
 * @property {boolean} [compactView] - Use compact list view
 */
export const updatePreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  sessionTimeout: z.number().int().min(0).max(120).optional(), // 0 = never timeout
  clipboardClear: z.number().int().min(0).max(300).optional(),
  showFavicons: z.boolean().optional(),
  compactView: z.boolean().optional(),
});

// ============================================
// AUDIT LOG SCHEMAS
// ============================================

/** Valid audit log action types */
export const auditActionSchema = z.enum([
  'LOGIN',
  'LOGOUT',
  'CREATE_ORG',
  'DELETE_ORG',
  'INVITE_USER',
  'APPROVE_USER',
  'REMOVE_USER',
  'UPDATE_USER_ROLE',
  'CREATE_SECRET',
  'VIEW_SECRET',
  'UPDATE_SECRET',
  'DELETE_SECRET',
  'CREATE_CATEGORY',
  'UPDATE_CATEGORY',
  'DELETE_CATEGORY',
  'CREATE_SHARE_LINK',
  'REVOKE_SHARE_LINK',
  'ACCESS_SHARE_LINK',
  'CREATE_EMERGENCY_CONTACT',
  'REVOKE_EMERGENCY_CONTACT',
  'REQUEST_EMERGENCY_ACCESS',
  'DENY_EMERGENCY_ACCESS',
  'VIEW_AUDIT_LOG',
  'EXPORT_AUDIT_LOG',
  'UPDATE_ORG_SETTINGS',
]);

/**
 * Audit log query validation
 * @property {number} [limit=50] - Results per page (1-100)
 * @property {number} [offset=0] - Pagination offset
 * @property {string} [action] - Filter by action type (must be valid action)
 * @property {string} [userId] - Filter by user UUID
 * @property {string} [startDate] - ISO 8601 start date
 * @property {string} [endDate] - ISO 8601 end date
 */
export const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  action: auditActionSchema.optional(),
  userId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// ============================================
// IMPORT/EXPORT SCHEMAS
// ============================================

/**
 * Secret import validation
 * @property {string} format - Source format: 'bitwarden_csv', 'lastpass_csv', 'generic_csv', 'cloudvault_json'
 * @property {string} data - Raw import data (CSV or JSON string)
 * @property {string} [categoryId] - Category to assign imported secrets
 */
export const importSecretsSchema = z.object({
  format: z.enum(['bitwarden_csv', 'lastpass_csv', 'generic_csv', 'cloudvault_json']),
  data: z.string().min(1, 'Import data is required'),
  categoryId: z.string().uuid().optional().nullable(),
});

// ============================================
// VALIDATION HELPERS
// ============================================

import { Context } from 'hono';

/**
 * Validate request body against a Zod schema
 * 
 * Parses the JSON request body and validates against the provided schema.
 * Throws ValidationError with detailed field-level messages on failure.
 * 
 * @template T - Zod schema type
 * @param {Context} c - Hono context object
 * @param {T} schema - Zod schema to validate against
 * @returns {Promise<z.infer<T>>} Validated and typed data
 * @throws {ValidationError} If validation fails
 * 
 * @example
 * ```typescript
 * const data = await validateBody(c, createSecretSchema);
 * // data is typed as { name: string, ciphertextBlob: string, ... }
 * ```
 */
export async function validateBody<T extends z.ZodSchema>(
  c: Context,
  schema: T
): Promise<z.infer<T>> {
  try {
    const body = await c.req.json();
    return schema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new ValidationError(messages);
    }
    throw new ValidationError('Invalid request body');
  }
}

/**
 * Validate query parameters against a Zod schema
 * 
 * Parses URL query parameters and validates against the provided schema.
 * Useful for GET requests with filters/pagination.
 * 
 * @template T - Zod schema type
 * @param {Context} c - Hono context object
 * @param {T} schema - Zod schema to validate against
 * @returns {z.infer<T>} Validated and typed query params
 * @throws {ValidationError} If validation fails
 * 
 * @example
 * ```typescript
 * const query = validateQuery(c, auditLogQuerySchema);
 * // query is typed as { limit: number, offset: number, ... }
 * ```
 */
export function validateQuery<T extends z.ZodSchema>(
  c: Context,
  schema: T
): z.infer<T> {
  try {
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    return schema.parse(query);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new ValidationError(messages);
    }
    throw new ValidationError('Invalid query parameters');
  }
}

/**
 * Custom validation error
 * 
 * Thrown when request validation fails. Caught by error handler
 * and returned as 400 Bad Request with error details.
 * 
 * @extends Error
 * 
 * @example
 * ```typescript
 * throw new ValidationError('email: Invalid email format');
 * // Results in: { "error": "email: Invalid email format", "type": "validation" }
 * ```
 */
export class ValidationError extends Error {
  /**
   * Create a validation error
   * @param {string} message - Human-readable error message
   */
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
