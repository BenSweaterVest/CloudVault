# Changelog

All notable changes to CloudVault will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### Upgrading to 0.1.0

This is the initial release. No upgrade path required.

### Future Upgrades

For future versions, migration guides will be included here when breaking changes occur. Always backup your data before upgrading.
