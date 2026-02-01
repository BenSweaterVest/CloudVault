/**
 * CloudVault API - Cloudflare Worker Entry Point
 * 
 * Zero-knowledge password vault API built on Cloudflare Workers.
 * Provides RESTful endpoints for authentication, secrets management,
 * organization administration, and audit logging.
 * 
 * @module worker/index
 * 
 * Architecture:
 * - Hono framework for routing and middleware
 * - Cloudflare D1 for SQLite database
 * - JWT-based authentication
 * - Zero-knowledge: server never sees plaintext secrets
 * 
 * @see {@link https://hono.dev} Hono Framework
 * @see {@link https://developers.cloudflare.com/d1} Cloudflare D1
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authRoutes } from './routes/auth';
import { secretsRoutes } from './routes/secrets';
import { orgsRoutes } from './routes/orgs';
import { auditRoutes } from './routes/audit';
import { usersRoutes } from './routes/users';
import { categoriesRoutes } from './routes/categories';
import { preferencesRoutes } from './routes/preferences';
import { sharingRoutes } from './routes/sharing';
import { emergencyRoutes } from './routes/emergency';
import { settingsRoutes } from './routes/settings';
import { securityHeaders, getCorsOrigin } from './middleware/security';
import { ValidationError } from './lib/validation';
import { apiRateLimit } from './middleware/rateLimit';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Cloudflare Worker environment bindings
 * 
 * These are configured in wrangler.toml and secrets.
 * 
 * @property {D1Database} DB - Cloudflare D1 database binding
 * @property {string} GITHUB_CLIENT_ID - GitHub OAuth app client ID
 * @property {string} GITHUB_CLIENT_SECRET - GitHub OAuth app client secret
 * @property {string} JWT_SECRET - Secret key for signing JWT tokens
 * @property {string} APP_URL - Frontend application URL (for CORS and redirects)
 * @property {string} [RESEND_API_KEY] - Resend API key for magic link emails
 */
export interface Env {
  /** Cloudflare D1 SQLite database */
  DB: D1Database;
  /** Cloudflare KV namespace for rate limiting and token blacklist */
  KV: KVNamespace;
  /** GitHub OAuth client ID */
  GITHUB_CLIENT_ID: string;
  /** GitHub OAuth client secret (stored as Cloudflare secret) */
  GITHUB_CLIENT_SECRET: string;
  /** JWT signing secret (stored as Cloudflare secret) */
  JWT_SECRET: string;
  /** Frontend URL for CORS and OAuth redirects */
  APP_URL: string;
  /** Resend API key for email (optional, enables magic links) */
  RESEND_API_KEY?: string;
  /** Email sender address (optional, defaults to noreply@cloudvault.app) */
  EMAIL_FROM?: string;
  /** Magic link expiration in minutes (optional, defaults to 15) */
  MAGIC_LINK_EXPIRY_MINUTES?: string;
  /** Environment: 'development' or 'production' */
  ENVIRONMENT?: string;
}

/**
 * Request context variables
 * 
 * Set by middleware and available in route handlers via `c.get()`.
 * 
 * @property {Object} [user] - Authenticated user (set by authMiddleware)
 */
export interface Variables {
  /** Authenticated user info (set by authMiddleware) */
  user?: {
    /** User UUID */
    id: string;
    /** User email address */
    email: string;
    /** User display name (nullable) */
    name: string | null;
  };
}

// ============================================
// ENVIRONMENT VALIDATION
// ============================================

/**
 * Validate required environment variables at startup
 * 
 * Throws descriptive errors if required variables are missing.
 * Called on first request to ensure worker can operate correctly.
 * 
 * @param env - Cloudflare Worker environment bindings
 * @throws {Error} If required environment variables are missing or invalid
 */
function validateEnv(env: Env): void {
  const required: (keyof Env)[] = ['DB', 'KV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'JWT_SECRET', 'APP_URL'];
  const missing = required.filter((key) => !env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Validate JWT_SECRET length for security
  if (env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters for security');
  }
  
  // Validate APP_URL format
  try {
    new URL(env.APP_URL);
  } catch {
    throw new Error('APP_URL must be a valid URL (e.g., https://your-app.pages.dev)');
  }
}

// ============================================
// APP SETUP
// ============================================

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Environment validation middleware (runs once per request)
let envValidated = false;
app.use('*', async (c, next) => {
  if (!envValidated) {
    validateEnv(c.env);
    envValidated = true;
  }
  await next();
});

// Global middleware
app.use('*', logger());

// Security headers middleware
app.use('*', securityHeaders);

// CORS - restricted to APP_URL in production
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      return getCorsOrigin(origin, c.env.APP_URL);
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // 24 hours
  })
);

/**
 * Health check endpoint
 * 
 * Used by monitoring systems and load balancers to verify the worker is running.
 * Returns current timestamp for debugging.
 * 
 * @route GET /api/health
 * @returns {{ status: 'ok', timestamp: string }}
 */
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// ROUTE MOUNTING
// ============================================

// Authentication routes (public, has its own stricter rate limiting)
app.route('/api/auth', authRoutes);

// Apply moderate rate limiting to all API routes (100 req/min)
app.use('/api/organizations/*', apiRateLimit);
app.use('/api/preferences/*', apiRateLimit);

// Organization routes (authenticated)
app.route('/api/organizations', orgsRoutes);
app.route('/api/organizations', secretsRoutes);
app.route('/api/organizations', auditRoutes);
app.route('/api/organizations', usersRoutes);
app.route('/api/organizations', categoriesRoutes);
app.route('/api/organizations', sharingRoutes);
app.route('/api/organizations', emergencyRoutes);
app.route('/api/organizations', settingsRoutes);

// User preferences (authenticated)
app.route('/api/preferences', preferencesRoutes);

// Public routes (no auth required, rate limited)
app.use('/api/share/*', apiRateLimit);
app.use('/api/emergency/*', apiRateLimit);
app.route('/api/share', sharingRoutes);      // Share link access
app.route('/api/emergency', emergencyRoutes); // Emergency access requests

// ============================================
// ERROR HANDLING
// ============================================

/**
 * 404 Not Found handler
 * 
 * Catches requests to undefined routes.
 */
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

/**
 * Global error handler
 * 
 * Catches all unhandled errors and returns appropriate HTTP responses.
 * - ValidationError: 400 Bad Request with field-level messages
 * - Other errors: 500 Internal Server Error (or custom status if set)
 * 
 * Security: Error messages are sanitized to prevent leaking internal details.
 * Full error details are logged server-side only.
 */
/** HTTP Error with status code */
interface HttpError extends Error {
  status?: number;
}

/** Type guard to check if error has a status property */
function hasStatus(err: unknown): err is HttpError {
  return typeof err === 'object' && err !== null && 'status' in err;
}

app.onError((err, c) => {
  // Log full error server-side for debugging
  console.error('API Error:', {
    message: err.message,
    stack: err.stack,
    url: c.req.url,
    method: c.req.method,
  });
  
  // Handle validation errors with 400 status (safe to expose)
  if (err instanceof ValidationError) {
    return c.json({ error: err.message, type: 'validation' }, 400);
  }
  
  // Handle known HTTP errors with their status code
  const status = hasStatus(err) ? err.status ?? 500 : 500;
  
  // For 4xx errors, message is usually safe to expose
  if (status >= 400 && status < 500) {
    return c.json({ error: err.message || 'Bad Request' }, status);
  }
  
  // For 5xx errors, don't expose internal error details
  // Return generic message to prevent information leakage
  return c.json({ error: 'An unexpected error occurred. Please try again.' }, 500);
});

export default app;
