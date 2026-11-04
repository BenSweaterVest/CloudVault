# Architecture

## Overview

```
┌────────────────────── Browser ──────────────────────┐
│ React app (Cloudflare Pages)                         │
│  lib/crypto.ts  Web Crypto: keys, items, sharing     │
│  hooks/useVault keys in memory only                  │
│  lib/api.ts     fetch client, session events         │
└───────────────┬──────────────────────────────────────┘
                │ HTTPS, JSON, ciphertext only
┌───────────────▼──────────────────────────────────────┐
│ Cloudflare Worker (Hono)                              │
│  security headers → CORS → route groups:              │
│   /api/auth          public + session routes          │
│   /api/share         public share links (rate limited)│
│   /api/organizations authMiddleware → org routers     │
│   /api/preferences   authMiddleware                   │
│   /api/emergency     authMiddleware (contacts)        │
│  scheduled()         daily maintenance (cron)         │
└───────────────┬──────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────┐
│ Cloudflare D1 (SQLite): all state                     │
└──────────────────────────────────────────────────────┘
```

D1 is the only storage binding. Earlier versions used KV for sessions and rate limits, but KV's free plan allows only 1,000 writes per day and is eventually consistent, so both moved to D1.

## Frontend

| Area | Files |
|------|-------|
| Crypto | `lib/crypto.ts` (keys, payloads, sharing), `lib/rotation.ts`, `lib/importers.ts` (CSV and encrypted backups), `lib/totp.ts`, `lib/passwords.ts` |
| State | `lib/auth.tsx` (session), `lib/preferences.tsx`, `hooks/useVault.tsx` (private key, org keys, current org, item list) |
| Shell | `components/ui/Layout.tsx` (navigation, auto-lock, shortcuts), `components/vault/VaultGate.tsx` (unlock and first-org screens) |
| Screens | `components/vault/*`, `components/admin/*`, `components/settings/*`, `components/share/*`, `components/emergency/*` |
| UI primitives | `components/ui/kit.tsx` |

Rules the frontend follows:

- Private and org keys live only in React state and refs. A page reload drops them.
- The item list holds metadata only. Opening an item fetches it (an audited view) and decrypts it.
- All API calls go through `lib/api.ts`. A 401 with `SESSION_TIMEOUT` or `SESSION_ENDED` returns the user to the login screen.
- Navigation inside the app uses the router; full page loads would lock the vault.

## Worker

```
src/
  index.ts              app assembly, error handler, cron export
  env.ts                Env bindings, context variables
  middleware/
    auth.ts             sessions (create, verify, revoke, idle timeout)
    rateLimit.ts        D1 fixed-window counters; in-memory limiter
    security.ts         headers, CORS origin policy
    audit.ts            action list, audit writes (also usable inside batches)
  lib/
    access.ts           requireMembership(c, orgId, minRole)
    validation.ts       Zod schemas, validateBody/validateQuery
    http.ts             HttpError, getUser, param helpers
    db.ts               chunkJson for json_each bulk writes
    email.ts            Resend wrapper, escaping
    crypto.ts           hashing helpers (no slow KDFs)
  routes/               one file per area
  scheduled.ts          maintenance job
```

Route handlers follow one pattern: read params, `requireMembership` with the minimum role, `validateBody` with a schema, run queries, write an audit entry, return JSON. Errors are thrown as `HttpError` or `ValidationError` and turned into JSON by the global handler. Unknown errors return a generic 500 and are logged.

### Free plan constraints in code

- **10 ms CPU per request:** no PBKDF2 or similar on the server. Share link passwords are stretched in the browser; the server compares SHA-256 hashes.
- **50 D1 queries per request, 100 bound parameters per query:** bulk operations (import, key rotation) pass rows as one JSON parameter and expand them with `json_each`. Multi-statement changes use `DB.batch()`, which also makes them atomic.
- **Write budget:** session activity is written at most once a minute per session; D1 rate limiting is used only on public endpoints.

## Data model

Defined by `worker/migrations/*.sql`.

| Table | Purpose |
|-------|---------|
| `users` | Email, name, public key, wrapped private key, salt, `kdf_iterations`, GitHub id |
| `organizations` | Name, `key_version` (incremented by rotation) |
| `memberships` | (user, org), role, status (`pending`/`active`), the user's encrypted copy of the org key |
| `secrets` | Metadata (name, url, username hint, type, category, tags, expiry) plus `ciphertext_blob`, `iv`, `enc_version`, `version` |
| `secret_history` | Previous ciphertext versions (newest 20 kept) |
| `secret_favorites` | Per-user favorites |
| `categories` | Per-org categories |
| `share_links` | Share ciphertext, expiry, view limits, optional password verifier |
| `emergency_contacts` | Contact user, waiting period, escrowed encrypted org key |
| `emergency_requests` | Requests and their status (`pending`, `approved`, `denied`, `granted`, `expired`) |
| `organization_settings` | Policies (min length, default expiry, sharing, emergency, audit retention) |
| `audit_logs` | Who, what, target, metadata, IP, user agent, time |
| `sessions` | JWT sessions: expiry, last activity, idle timeout, revoked |
| `rate_limits` | Fixed-window counters |
| `magic_links` | SHA-256 of outstanding login tokens |
| `user_preferences` | Theme, idle timeout, clipboard clearing, compact view |

## Daily maintenance

`scheduled.ts` runs once a day (`[triggers] crons` in `wrangler.toml`): deletes expired sessions, rate-limit counters and magic links; clears ciphertext from dead share links; expires emergency requests whose contact was removed; deletes audit rows older than each org's retention.

## Deployment shape

- Frontend: static build on Cloudflare Pages. `VITE_API_URL` points at the Worker (or leave it as `/api` if you route the Worker on the same hostname).
- Worker: `wrangler deploy` after `wrangler d1 migrations apply --remote`.
- CI (`.github/workflows/ci.yml`): lint, typecheck, tests and build for both packages on every push and PR; deploys from `main` when Cloudflare credentials are configured.
