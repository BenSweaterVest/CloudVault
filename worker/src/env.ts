/**
 * Worker environment bindings and request context types.
 *
 * Kept in their own module so routes and middleware can import them without
 * creating an import cycle through the app entry point.
 */

import type { Context } from 'hono';

export interface Env {
  /** Cloudflare D1 SQLite database (all persistent state lives here) */
  DB: D1Database;
  /** GitHub OAuth client ID. Optional: without it, GitHub sign-in is hidden. */
  GITHUB_CLIENT_ID?: string;
  /** GitHub OAuth client secret (Cloudflare secret) */
  GITHUB_CLIENT_SECRET?: string;
  /** JWT signing secret, at least 32 characters (Cloudflare secret) */
  JWT_SECRET: string;
  /** Frontend URL, used for CORS, OAuth redirects and links in emails */
  APP_URL: string;
  /** Resend API key. Enables magic link, invite and emergency emails. */
  RESEND_API_KEY?: string;
  /** Email sender address. Defaults to "CloudVault <noreply@cloudvault.app>" */
  EMAIL_FROM?: string;
  /** Magic link lifetime in minutes. Defaults to 15. */
  MAGIC_LINK_EXPIRY_MINUTES?: string;
  /**
   * When "false", only users who already exist (for example because an admin
   * invited them) can sign in. Defaults to open sign-up.
   */
  ALLOW_SIGNUPS?: string;
  /** "development" or "production" */
  ENVIRONMENT?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export interface SessionInfo {
  id: string;
  expiresAt: number;
}

export interface Variables {
  user?: AuthUser;
  session?: SessionInfo;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
export type AppContext = Context<AppEnv>;
