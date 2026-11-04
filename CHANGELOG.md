# Changelog

All notable changes to CloudVault will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-11-04

A full overhaul focused on making the advertised features work, closing security gaps, and staying inside Cloudflare's free plan.

### Security
- GitHub sign-in only trusts a verified primary email and matches on GitHub id first. Previously an unverified email on a GitHub account could sign in as an existing user with that address.
- OAuth `state` is generated and verified by the client.
- Magic link tokens are 256-bit, stored hashed, consumed atomically, and delivered in the URL fragment.
- Sessions are stored in D1: logout, "sign out everywhere" and the user's idle timeout are enforced server side (the cached timeout was previously ignored).
- Member approval and emergency contacts require comparing key fingerprints, so a compromised server cannot substitute a public key.
- Items are bound to their org and id with AES-GCM associated data (`enc_version` 2).
- New keys use RSA-3072 and PBKDF2 with 600,000 iterations; iteration counts are stored per user.
- Org key rotation, offered after removing a member.
- All request bodies are validated; URLs must be http(s); roles are validated; an org always keeps an admin.
- Audit CSV export neutralizes spreadsheet formulas; CORS origin matching is exact.
- The frontend build emits a strict Content Security Policy for Pages.

### Fixed
- Magic link sign-in (the landing page was missing).
- Share links (recipients could not decrypt them).
- Emergency access (requests could never be granted).
- TOTP codes (always showed an error).
- Auto-lock, clipboard clearing and keyboard shortcuts (were never wired up).
- Export and "expiring" endpoints were unreachable (shadowed by `/:secretId`).
- Item views were never audited; the list no longer includes ciphertext, so each view is a logged fetch.
- API error messages always read "Request failed".
- Password generator bias; CSV import trimming passwords; viewport zoom disabled.
- TypeScript build, lint and test failures.

### Added
- Typed items (logins with 2FA codes, notes, API keys, payment cards) and encrypted custom fields.
- Version history with decryption and restore (newest 20 versions kept).
- Weak and reused password check on the Health page (runs in the browser).
- Passphrase-encrypted backups and Bitwarden-format CSV export.
- Master password change; profile name; sign out everywhere; leave organization; rename organization.
- Optimistic concurrency for edits; per-user favorites.
- Invite-only mode (`ALLOW_SIGNUPS=false`); GitHub and email sign-in are each optional.
- Daily maintenance cron (expired data clean-up, audit retention).
- Worker route tests on a D1 shim; frontend crypto, TOTP and importer tests.

### Changed
- KV removed. D1 is the only storage binding.
- `wrangler d1 migrations` replace `schema.sql`.
- Bulk import and key rotation run as single `json_each` statements (D1 free plan query limits).
- Share link passwords are stretched in the browser; the Worker only compares hashes.
- "Require 2FA" setting removed (it was never enforced).
- Custom field tables removed; custom fields live in the encrypted payload.
- CI consolidated and runs on Node 22; deploys apply migrations and skip when credentials are missing.

## [0.2.0] - 2025-01-31

### Added
- Secure sharing links for temporary external access
- Emergency access with trusted contacts
- Password health dashboard with scoring
- Organization settings page
- TOTP 2FA code storage and generation
- Custom fields support for secrets
- Category management with custom icons and colors
- User preferences page (theme, timeout, clipboard settings)
- PWA manifest for mobile app-like experience
- Organization deletion (admin only)
- Import/Export functionality (Bitwarden, LastPass, CSV)
- Secret search, filtering, and sorting
- Comprehensive test suite
  - Frontend: crypto, hooks, components, API, integration tests
  - Worker: validation schema tests
- Distributed rate limiting using Cloudflare KV
- JWT token blacklist for secure logout
- Server-side session timeout enforcement

### Changed
- Improved dark mode support across all components
- Enhanced accessibility with ARIA labels
- Standardized error message styling
- Added Zod validation to all auth routes
- Improved database schema with missing foreign keys
- Added performance indexes for common queries
- Organization creation now uses atomic batch operations
- Updated wrangler compatibility date to 2024-12-01

### Security
- PBKDF2 password hashing for share links (100,000 iterations)
- Expanded audit action types for better tracking
- Added validation for audit log action filter parameter
- Improved error logging to avoid exposing sensitive data
- Added error handling for email service failures

### Documentation
- Testing guide (docs/TESTING.md)
- Comprehensive JSDoc for all major functions
- Updated API documentation with new endpoints
- Updated project structure
- Added ESLint configuration for worker package
- Added Prettier configuration for consistent formatting

## [0.1.0] - 2024-01-15

### Added

#### Core Features
- Zero-knowledge encryption architecture using Web Crypto API
- RSA-4096 user key pairs for identity
- AES-256-GCM organization keys for secrets
- PBKDF2 key derivation from master password (100,000 iterations)

#### Authentication
- GitHub OAuth integration
- Magic link email authentication (via Resend)
- JWT-based session management
- Rate limiting on auth endpoints

#### Organizations
- Create and manage organizations
- Invite users via email
- Role-based access control (admin, member, read_only)
- Secure key exchange for new members

#### Secrets Management
- Create, read, update, delete secrets
- Multiple secret types: password, note, API key, card
- Categories for organization
- Tags for flexible labeling
- Favorites for quick access
- Password history with version tracking
- Expiration date tracking

#### Audit & Compliance
- Comprehensive audit logging
- Track views, edits, and deletions
- User activity monitoring
- CSV export for compliance reports

#### User Interface
- Modern React + Tailwind CSS design
- Dark mode with system preference detection
- Responsive layout for mobile
- Keyboard shortcuts (Cmd+K, Cmd+N, etc.)
- Toast notifications for feedback
- Skeleton loaders for smooth UX

#### Security Features
- Auto-lock after inactivity (configurable)
- Clipboard auto-clear after copy
- Security headers (CSP, HSTS, etc.)
- Input validation with Zod schemas

#### Password Tools
- Configurable password generator
- Length: 8-64 characters
- Character sets: uppercase, lowercase, numbers, symbols
- Exclude ambiguous characters option
- Strength indicator

#### Import/Export
- Import from Bitwarden CSV
- Import from LastPass CSV
- Import from generic CSV
- CloudVault JSON backup/restore
- CSV export (names only, no passwords)

#### Developer Experience
- TypeScript throughout
- ESLint configuration
- Vitest test framework
- GitHub Actions CI/CD
- Comprehensive documentation

### Security
- Zero-knowledge: server never sees plaintext
- End-to-end encryption for all secrets
- Secure key exchange protocol
- Rate limiting protection
- CORS restrictions

### Infrastructure
- Cloudflare Workers for API
- Cloudflare D1 for database
- Cloudflare Pages for frontend
- Free tier compatible

---

## Version History Format

### [X.Y.Z] - YYYY-MM-DD

#### Added
- New features

#### Changed
- Changes to existing functionality

#### Deprecated
- Features that will be removed in future versions

#### Removed
- Features that were removed

#### Fixed
- Bug fixes

#### Security
- Security-related changes

---

## Upgrade Notes

### Upgrading from 0.2.x

1. **Back up first:** `npx wrangler d1 export cloudvault-db --remote --output backup.sql`.
2. **Apply migrations:** `cd worker && npm run db:migrate:prod`. `0001_initial.sql` is safe on an existing database (every statement is `IF NOT EXISTS`). `0002_overhaul.sql` adds the new columns and tables.
3. **Remove KV:** delete the `[[kv_namespaces]]` block from `wrangler.toml` (already gone in the repository version). You can delete the namespace in the dashboard afterwards.
4. **Deploy the Worker, then the frontend** (rebuild with `VITE_API_URL` if the API is on another origin).

What users will notice:
- Everyone is signed out once (sessions moved to D1), and outstanding magic links stop working.
- Existing share links and emergency contacts are revoked, because the old versions could never be used. Create them again.
- Favorites become personal; each member keeps the favorites the org had.
- Existing items stay readable. They move to the new format when edited, or all at once with **Settings > Rotate vault key**.
- Accounts keep their current key strength until the master password is changed (the same password can be reused); Preferences shows a notice.
