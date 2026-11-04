/**
 * CloudVault API (Cloudflare Worker entry point)
 *
 * Zero-knowledge password vault API. The server stores and authorizes access
 * to ciphertext; all encryption and decryption happens in the browser.
 *
 * Designed for the Cloudflare free plan: D1 is the only storage binding, no
 * slow cryptography runs server side, and bulk writes are single statements.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv, Env } from './env';
import { authRoutes } from './routes/auth';
import { secretsRoutes } from './routes/secrets';
import { orgsRoutes } from './routes/orgs';
import { auditRoutes } from './routes/audit';
import { categoriesRoutes } from './routes/categories';
import { preferencesRoutes } from './routes/preferences';
import { publicShareRoutes, sharingRoutes } from './routes/sharing';
import { emergencyAdminRoutes, emergencyContactRoutes } from './routes/emergency';
import { settingsRoutes } from './routes/settings';
import { authMiddleware } from './middleware/auth';
import { securityHeaders, getCorsOrigin } from './middleware/security';
import { apiRateLimit, publicShareRateLimit } from './middleware/rateLimit';
import { HttpError } from './lib/http';
import { ValidationError } from './lib/validation';
import { runMaintenance } from './scheduled';

export type { Env, Variables } from './env';

// ============================================
// ENVIRONMENT VALIDATION
// ============================================

export function validateEnv(env: Env): string[] {
  const problems: string[] = [];
  const required: (keyof Env)[] = ['DB', 'JWT_SECRET', 'APP_URL'];
  for (const key of required) {
    if (!env[key]) problems.push(`Missing required setting: ${key}`);
  }
  if (env.JWT_SECRET && env.JWT_SECRET.length < 32) problems.push('JWT_SECRET must be at least 32 characters');
  if (!!env.GITHUB_CLIENT_ID !== !!env.GITHUB_CLIENT_SECRET) {
    problems.push('Set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or neither');
  }
  if (env.APP_URL) {
    try {
      new URL(env.APP_URL);
    } catch {
      problems.push('APP_URL must be a valid URL, for example https://vault.example.org');
    }
  }
  return problems;
}

let envChecked = false;

// ============================================
// APP
// ============================================

export const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  if (!envChecked) {
    const problems = validateEnv(c.env);
    if (problems.length > 0) {
      console.error('Configuration errors:', problems.join('; '));
      throw new HttpError(503, 'The server is not configured correctly. Check the worker logs.');
    }
    envChecked = true;
  }
  await next();
});

app.use('*', securityHeaders);

app.use(
  '*',
  cors({
    origin: (origin, c) => getCorsOrigin(origin, c.env.APP_URL),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Retry-After', 'Content-Disposition'],
    maxAge: 86400,
  })
);

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Public and self-protecting routes
app.route('/api/auth', authRoutes);

const share = new Hono<AppEnv>();
share.use('*', publicShareRateLimit);
share.route('/', publicShareRoutes);
app.route('/api/share', share);

// Authenticated routes
const orgs = new Hono<AppEnv>();
orgs.use('*', authMiddleware, apiRateLimit);
orgs.route('/', orgsRoutes);
orgs.route('/', secretsRoutes);
orgs.route('/', categoriesRoutes);
orgs.route('/', auditRoutes);
orgs.route('/', settingsRoutes);
orgs.route('/', sharingRoutes);
orgs.route('/', emergencyAdminRoutes);
app.route('/api/organizations', orgs);

const prefs = new Hono<AppEnv>();
prefs.use('*', authMiddleware, apiRateLimit);
prefs.route('/', preferencesRoutes);
app.route('/api/preferences', prefs);

const emergency = new Hono<AppEnv>();
emergency.use('*', authMiddleware, apiRateLimit);
emergency.route('/', emergencyContactRoutes);
app.route('/api/emergency', emergency);

// ============================================
// ERRORS
// ============================================

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

app.onError((err, c) => {
  if (err instanceof ValidationError) {
    return c.json({ error: err.message, type: 'validation' }, 400);
  }
  if (err instanceof HttpError) {
    if (err.status >= 500) console.error('API error:', err.message);
    return c.json({ error: err.message, code: err.code, ...err.extra }, err.status as ContentfulStatusCode);
  }

  // Unknown errors: log details server side, return a generic message.
  console.error('Unhandled API error:', {
    message: err.message,
    stack: err.stack,
    method: c.req.method,
    path: c.req.path,
  });
  return c.json({ error: 'An unexpected error occurred. Please try again.' }, 500);
});

// ============================================
// EXPORTS
// ============================================

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runMaintenance(env).then(
        (counts) => console.log('Maintenance complete', counts),
        (err) => console.error('Maintenance failed:', err instanceof Error ? err.message : err)
      )
    );
  },
} satisfies ExportedHandler<Env>;
