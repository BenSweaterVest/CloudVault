# CloudVault

[![CI](https://github.com/BenSweaterVest/CloudVault/actions/workflows/ci.yml/badge.svg)](https://github.com/BenSweaterVest/CloudVault/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A shared password vault for small organizations (nonprofits, boards, clubs, small teams) that runs entirely on Cloudflare's **free plan**. Passwords are encrypted and decrypted in each person's browser; the server only ever stores ciphertext.

## Contents

- [What it does](#what-it-does)
- [How the encryption works](#how-the-encryption-works)
- [What the server can see](#what-the-server-can-see)
- [Tech stack](#tech-stack)
- [Getting started (local)](#getting-started-local)
- [Deploying](#deploying)
- [Free plan budget](#free-plan-budget)
- [Project layout](#project-layout)
- [Documentation](#documentation)

## What it does

**Vault**
- Logins (with built-in 2FA code generator), secure notes, API keys and payment cards, plus encrypted custom fields
- Categories, tags, per-person favorites, search and filters
- Version history: the last 20 versions of each item, decrypted locally, with one-click restore
- Expiry dates with reminders on the Health page, plus an in-browser weak and reused password check
- Password generator (unbiased, configurable, respects the organization's minimum length)

**Teams**
- Multiple organizations per person; roles: admin, member, read-only
- Invitations by email; admins approve new members after comparing **key fingerprints**, so a compromised server cannot slip in its own key
- **Org key rotation** in the browser, offered automatically after removing someone
- **Audit log** of sign-ins, every view, edit, export, share and admin action, with CSV export for board reporting and configurable retention

**Sharing and continuity**
- **Share links** for people outside the vault: expiring, view-limited, optionally password protected. The decryption key lives only in the link's `#fragment`, never on the server
- **Emergency access**: admins name a trusted person; if every admin becomes unreachable, that person can request read-only access, which is granted after a waiting period unless an admin denies it
- **Import** from Bitwarden, LastPass or any CSV; **export** as a passphrase-encrypted backup or a Bitwarden-format CSV

**Sign-in and session security**
- GitHub OAuth or emailed magic links (via Resend's free tier); optional invite-only mode
- Vault auto-locks after inactivity; the server also ends idle sessions; "sign out everywhere"
- Copied passwords are cleared from the clipboard after a delay you choose
- Master password change (keys are re-encrypted locally; organization access is unaffected)

## How the encryption works

```
master password --PBKDF2-SHA256 (600k)--> wrapping key
wrapping key    --AES-256-GCM-->          your RSA-OAEP private key (stored encrypted)
your public key --RSA-OAEP-->             the organization key (one copy per member)
organization key --AES-256-GCM + AAD-->   each item
```

- Each item is bound to its organization and id with AES-GCM associated data, so the server cannot swap ciphertext between items undetected.
- Admins approve members by encrypting the org key for the member's public key, after checking the member's key fingerprint out of band.
- Share links re-encrypt one item under a random key that only exists in the link.

There is **no master password recovery**. That is the point of the design. See [docs/SECURITY.md](docs/SECURITY.md) for the full model, including its limits.

## What the server can see

| Data | Visible to the server |
|------|-----------------------|
| Passwords, notes, card numbers, API keys, 2FA secrets, custom fields | No (encrypted) |
| Organization keys, private keys, master passwords | No |
| Item name, website, username, category, tags, expiry date | Yes (for search and reminders) |
| Who viewed or changed what, and when | Yes (audit log) |
| Email addresses and public keys | Yes |

Don't put sensitive information in an item's name or website. Use the notes or custom fields instead.

## Tech stack

- **Frontend:** React 18, Vite, Tailwind CSS, Web Crypto API (no crypto dependencies), hosted on Cloudflare Pages
- **API:** Cloudflare Workers with Hono and Zod
- **Storage:** Cloudflare D1 (SQLite), the only storage binding
- **Email:** Resend (optional)
- **Tests:** Vitest. The API tests run real SQL against the real migrations using Node's built-in SQLite.

## Getting started (local)

Requires Node.js 22+.

```bash
git clone https://github.com/BenSweaterVest/CloudVault.git
cd CloudVault
(cd worker && npm install)
(cd frontend && npm install)
```

Configure the worker:

```bash
cd worker
cp .dev.vars.example .dev.vars   # then edit: JWT_SECRET, APP_URL=http://localhost:5173
npm run db:migrate               # creates the local D1 database
npm run dev                      # API on http://localhost:8787
```

In a second terminal:

```bash
cd frontend
npm run dev                      # app on http://localhost:5173
```

Without a Resend key, magic links are printed in the worker's terminal output, so you can sign in by email locally. GitHub sign-in needs an OAuth app whose callback URL is `http://localhost:5173/auth/github/callback`.

### Commands

| Where | Command | What it does |
|-------|---------|--------------|
| both | `npm run lint` / `npm run typecheck` / `npm run test:run` | Checks used by CI |
| worker | `npm run db:migrate` / `npm run db:migrate:prod` | Apply D1 migrations locally / to production |
| worker | `npm run deploy` | Deploy the Worker |
| frontend | `npm run build` | Production build (also writes the Pages `_headers` file with a strict CSP) |

## Deploying

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. In short: create a D1 database, set four secrets, apply migrations, deploy the Worker, and deploy the frontend to Pages with `VITE_API_URL` pointing at the Worker. GitHub Actions can do the last three steps on every push to `main`.

Upgrading from 0.2.x? Read the [upgrade notes](CHANGELOG.md#upgrading-from-02x) first. The KV namespace is no longer needed.

## Free plan budget

CloudVault is built to stay inside Cloudflare's free limits for a small organization:

| Resource | Free limit | How CloudVault uses it |
|----------|-----------|------------------------|
| Worker requests | 100,000 / day | A few hundred per active person per day |
| Worker CPU | 10 ms / request | No slow cryptography on the server; all KDFs run in the browser |
| D1 rows written | 100,000 / day | Session activity is written at most once a minute; rate limits only on public endpoints |
| D1 queries | 50 / request | Bulk imports and key rotation are single `json_each` statements |
| D1 storage | 5 GB | Megabytes for a typical organization; history is capped at 20 versions per item |
| Cron triggers | 5 | One daily cleanup job |
| Resend email | 100 / day | Magic links, invitations, emergency notices |

There is no KV, R2 or Durable Objects dependency.

## Project layout

```
worker/                  Cloudflare Worker (API)
  migrations/            D1 schema migrations (wrangler d1 migrations)
  src/
    index.ts             app, routing, error handling, cron entry
    env.ts               bindings and context types
    routes/              auth, orgs (members, key rotation), secrets, categories,
                         sharing, emergency, settings, audit, preferences
    middleware/          sessions, rate limiting, security headers, audit logging
    lib/                 validation (Zod), access control, email, DB helpers
    scheduled.ts         daily maintenance
    __tests__/           route tests on a node:sqlite D1 shim
frontend/                React app (Cloudflare Pages)
  src/
    lib/                 crypto, API client, TOTP, passwords, importers, rotation
    hooks/               vault state, clipboard, idle timeout
    components/          screens, grouped by area
    __tests__/
docs/                    architecture, security, API, deployment, testing, FAQ
```

## Documentation

- [Security model](docs/SECURITY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Testing](docs/TESTING.md)
- [FAQ](docs/FAQ.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## License

MIT
