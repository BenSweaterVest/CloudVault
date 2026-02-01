# CloudVault

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built with Cloudflare Workers](https://img.shields.io/badge/Built%20with-Cloudflare%20Workers-orange)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb)](https://react.dev/)

A zero-knowledge serverless password vault for small organizations, built on Cloudflare's free tier.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Deployment](#deployment)
- [Security Architecture](#security-architecture)
- [Contributing](#contributing)
- [Documentation](#documentation)
- [License](#license)

## Features

### Core Security
- **Zero-Knowledge Architecture**: All encryption/decryption happens in the browser. The server never sees plaintext passwords.
- **Audit Logging**: Track who viewed, created, or modified credentials - perfect for nonprofit governance.
- **Password History**: View previous versions of credentials with full change tracking.
- **Role-Based Access**: Admin, Member, and Read-Only roles for different access levels.
- **Session Timeout**: Server-enforced auto-lock after configurable period of inactivity.
- **Clipboard Auto-Clear**: Passwords cleared from clipboard after 30 seconds.
- **JWT Token Blacklist**: Logout immediately invalidates tokens server-side.

### Authentication
- **Dual Authentication**: GitHub OAuth for developers, Magic Links for non-technical board members.
- **Distributed Rate Limiting**: Global rate limiting via Cloudflare KV protects against brute-force attacks.

### Organization
- **Multiple Secret Types**: Passwords, secure notes, API keys, and payment cards.
- **Categories**: Organize secrets with custom categories, icons, and colors.
- **Tags & Search**: Full-text search across names, URLs, and tags.
- **Favorites**: Quick access to frequently used credentials.
- **Expiration Tracking**: Set and monitor password expiration dates.

### User Experience
- **Dark Mode**: Full dark theme with system preference detection.
- **Keyboard Shortcuts**: Cmd/Ctrl+K for search, Cmd+N for new, etc.
- **Password Generator**: Configurable secure password generation.
- **Import/Export**: Import from Bitwarden, LastPass, or generic CSV; export encrypted backups.
- **Skeleton Loaders**: Smooth loading states instead of spinners.
- **Toast Notifications**: Feedback for all user actions.

### Accessibility
- **WCAG 2.1 AA Compliant**: Skip links, ARIA labels, focus management.
- **Screen Reader Support**: Live region announcements for dynamic content.
- **Keyboard Navigation**: Full keyboard accessibility throughout.

## Tech Stack

- **Frontend**: React 18 + Vite 5 + Tailwind CSS (deployed to Cloudflare Pages)
- **Backend**: Cloudflare Workers with Hono framework
- **Database**: Cloudflare D1 (SQLite)
- **Cache/State**: Cloudflare KV (rate limiting, token blacklist, session tracking)
- **Auth**: GitHub OAuth + Magic Links (via Resend)
- **Crypto**: Web Crypto API (native browser, zero dependencies)
- **Validation**: Zod schemas for all API endpoints
- **Testing**: Vitest + Testing Library
- **CI/CD**: GitHub Actions with auto-deploy

## Project Structure

```
cloudvault/
├── .github/
│   └── workflows/
│       └── ci.yml           # CI/CD pipeline
├── docs/                    # Documentation
│   ├── API.md               # API reference
│   ├── ARCHITECTURE.md      # System design
│   ├── DEPLOYMENT.md        # Deployment guide
│   ├── SECURITY.md          # Security documentation
│   └── TESTING.md           # Testing guide
├── frontend/                # React app (Cloudflare Pages)
│   ├── src/
│   │   ├── components/
│   │   │   ├── admin/       # AuditLog, UserManagement, HealthDashboard, OrgSettings
│   │   │   ├── auth/        # Login, OAuth callbacks
│   │   │   ├── ui/          # Toast, Theme, Skeleton, Accessibility
│   │   │   └── vault/       # SecretList, PasswordGenerator, ImportExport, ShareModal, TOTP
│   │   ├── hooks/           # useClipboard, useSessionTimeout, useKeyboardShortcuts
│   │   ├── lib/             # Crypto, API, Auth utilities
│   │   └── __tests__/       # Unit & integration tests
│   │       ├── setup.ts     # Test environment config
│   │       ├── crypto.test.ts
│   │       ├── hooks.test.ts
│   │       ├── components.test.tsx
│   │       ├── api.test.ts
│   │       ├── totp.test.ts
│   │       └── integration.test.ts
│   └── package.json
├── worker/                  # API (Cloudflare Workers)
│   ├── src/
│   │   ├── routes/          # auth, secrets, categories, preferences, audit, sharing, emergency, settings
│   │   ├── middleware/      # auth, audit, security, rateLimit
│   │   ├── lib/             # validation (Zod schemas)
│   │   ├── db/              # schema.sql
│   │   └── __tests__/       # API validation tests
│   │       └── validation.test.ts
│   └── wrangler.toml
├── CONTRIBUTING.md          # Contribution guidelines
├── CHANGELOG.md             # Version history
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+
- Cloudflare account (free tier)
- GitHub OAuth app (for authentication)

### 1. Clone and Install

```bash
cd cloudvault

# Install frontend dependencies
cd frontend
npm install

# Install worker dependencies
cd ../worker
npm install
```

### 2. Set Up Cloudflare D1 and KV

```bash
cd worker

# Create the database
npx wrangler d1 create cloudvault-db
# Copy the database_id from the output and update wrangler.toml

# Create KV namespace for rate limiting and session management
npx wrangler kv:namespace create "RATE_LIMIT"
# Copy the id from the output and update wrangler.toml

# Run migrations
npm run db:migrate
```

### 3. Configure GitHub OAuth

1. Go to GitHub Settings > Developer Settings > OAuth Apps
2. Create a new OAuth app:
   - Homepage URL: `http://localhost:5173` (dev) or your Pages URL
   - Callback URL: `http://localhost:8787/api/auth/github/callback`
3. Copy Client ID and Secret

### 4. Set Environment Variables

For local development, create a `.dev.vars` file in the `worker` directory:

```
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
JWT_SECRET=your_random_secret_here
APP_URL=http://localhost:5173
RESEND_API_KEY=your_resend_key  # Optional, for magic links
```

### 5. Run Locally

```bash
# Terminal 1: Start the API
cd worker
npm run dev

# Terminal 2: Start the frontend
cd frontend
npm run dev
```

Visit `http://localhost:5173` to see the app.

### Development Commands

```bash
# Frontend
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint check
npm run lint:fix     # Auto-fix lint issues
npm run typecheck    # TypeScript check
npm run test         # Run tests
npm run test:coverage # Tests with coverage

# Worker
npm run dev          # Start local worker
npm run deploy       # Deploy to Cloudflare
npm run typecheck    # TypeScript check
npm run db:migrate   # Run local migrations
npm run db:migrate:prod # Run production migrations
```

## Deployment

### Deploy the Worker

```bash
cd worker

# Set production secrets
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put JWT_SECRET
npx wrangler secret put APP_URL

# Deploy
npm run deploy

# Run production migrations
npm run db:migrate:prod
```

### Deploy the Frontend

```bash
cd frontend
npm run build

# Deploy to Cloudflare Pages via dashboard or CLI
npx wrangler pages deploy dist
```

## Security Architecture

### Zero-Knowledge Encryption

1. **User Identity**: Each user has an RSA-OAEP key pair
   - Public key stored on server
   - Private key encrypted with master password, stored on server

2. **Organization Key**: Each org has an AES-256-GCM key
   - Encrypted separately for each member using their public key
   - Stored in `memberships.encrypted_org_key`

3. **Secrets**: Encrypted with the organization's AES key
   - Server only sees ciphertext
   - Decryption happens in browser

### Key Exchange Flow

When adding a new user:
1. New user creates account, generates key pair
2. Admin approves user in their browser
3. Admin's browser decrypts org key, re-encrypts for new user's public key
4. Encrypted org key uploaded to server

## Free Tier Limits

| Service | Free Limit | Typical Usage |
|---------|------------|---------------|
| Workers | 100k req/day | ~500/day for 20 users |
| D1 Storage | 5GB | ~10MB for small org |
| D1 Reads | 5M/day | ~5k/day |
| Pages | Unlimited | Static hosting |
| Resend | 100 emails/day | Magic links |

## Documentation

- **[API Reference](docs/API.md)** - Complete API endpoint documentation
- **[Security](docs/SECURITY.md)** - Cryptographic design and threat model
- **[Architecture](docs/ARCHITECTURE.md)** - System design and data flow diagrams
- **[Deployment Guide](docs/DEPLOYMENT.md)** - Step-by-step deployment instructions
- **[Testing Guide](docs/TESTING.md)** - How to run and write tests
- **[Contributing](CONTRIBUTING.md)** - How to contribute to the project
- **[Changelog](CHANGELOG.md)** - Version history and release notes

## License

MIT
