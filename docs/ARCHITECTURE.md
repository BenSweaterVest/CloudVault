# CloudVault Architecture

## System Overview

CloudVault is a serverless password vault built entirely on Cloudflare's platform.

```
┌─────────────────────────────────────────────────────────────────────┐
│                           User's Browser                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │   React     │  │  Web Crypto │  │  IndexedDB  │  │ LocalStorage│ │
│  │   Frontend  │  │     API     │  │  (future)   │  │  (tokens)  │ │
│  └──────┬──────┘  └──────┬──────┘  └─────────────┘  └────────────┘ │
│         │                │                                          │
└─────────┼────────────────┼──────────────────────────────────────────┘
          │                │
          │ HTTPS          │ Encryption/
          │                │ Decryption
          ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Edge                               │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    Cloudflare Pages                              ││
│  │                 (Static Frontend Hosting)                        ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    Cloudflare Workers                            ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       ││
│  │  │   Hono   │  │   Auth   │  │ Security │  │  Audit   │       ││
│  │  │  Router  │  │Middleware│  │ Middleware│  │  Logger  │       ││
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       ││
│  │       └──────────────┴────────────┴─────────────┘              ││
│  │                           │                                     ││
│  │                           ▼                                     ││
│  │  ┌─────────────────────────────────────────────────────────┐   ││
│  │  │                    Cloudflare D1                         │   ││
│  │  │                  (SQLite Database)                       │   ││
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │   ││
│  │  │  │  users  │ │  orgs   │ │ secrets │ │ audit_logs  │   │   ││
│  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────────┘   │   ││
│  │  └─────────────────────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

## Component Details

### Frontend (Cloudflare Pages)

**Technology**: React 18, Vite 5, Tailwind CSS, TypeScript

**Key Modules**:
- `lib/crypto.ts` - Web Crypto API wrapper for all encryption
- `lib/api.ts` - API client with typed endpoints
- `lib/auth.tsx` - Authentication context and hooks
- `hooks/useVault.tsx` - Vault state management
- `components/` - React components

**State Management**:
- React Context for global state (auth, vault)
- Local state for component-specific data
- LocalStorage for JWT tokens and preferences

### Backend (Cloudflare Workers)

**Technology**: Hono framework, TypeScript, Zod

**Route Structure**:
```
/api
├── /auth
│   ├── GET  /github          → OAuth redirect
│   ├── POST /github/callback → Token exchange
│   ├── POST /magic-link      → Request magic link
│   ├── POST /magic-link/verify → Verify token
│   ├── GET  /me              → Current user
│   └── POST /setup-keys      → Initialize keys
├── /organizations
│   ├── GET  /                → List orgs
│   ├── POST /                → Create org
│   └── /:orgId
│       ├── /members          → User management
│       ├── /secrets          → Secret CRUD
│       ├── /categories       → Category CRUD
│       └── /audit            → Audit logs
└── /preferences              → User settings
```

**Middleware Stack**:
1. `logger` - Request logging
2. `securityHeaders` - HTTP security headers
3. `cors` - Cross-origin restrictions
4. `authMiddleware` - JWT verification (per-route)
5. `rateLimit` - Request throttling

### Database (Cloudflare D1)

**Engine**: SQLite (distributed)

**Schema Design**:

```
┌───────────────────┐       ┌───────────────────┐
│      users        │       │   organizations   │
├───────────────────┤       ├───────────────────┤
│ id (PK)           │       │ id (PK)           │
│ email             │       │ name              │
│ name              │       │ created_at        │
│ public_key        │       └─────────┬─────────┘
│ encrypted_priv_key│                 │
│ salt              │                 │
│ auth_provider     │                 │
│ github_id         │                 │
│ created_at        │                 │
└─────────┬─────────┘                 │
          │                           │
          │         ┌─────────────────┘
          │         │
          ▼         ▼
┌───────────────────────────┐
│       memberships         │
├───────────────────────────┤
│ user_id (PK, FK)          │
│ org_id (PK, FK)           │
│ role                      │
│ encrypted_org_key         │
│ status                    │
│ invited_by                │
│ created_at                │
└───────────────────────────┘
          │
          │ org_id
          ▼
┌───────────────────┐       ┌───────────────────┐
│     secrets       │       │    categories     │
├───────────────────┤       ├───────────────────┤
│ id (PK)           │◄──────│ id (PK)           │
│ org_id (FK)       │       │ org_id (FK)       │
│ name              │       │ name              │
│ url               │       │ icon              │
│ username_hint     │       │ color             │
│ ciphertext_blob   │       │ sort_order        │
│ iv                │       │ created_at        │
│ version           │       └───────────────────┘
│ category_id (FK)  │
│ is_favorite       │
│ secret_type       │
│ expires_at        │
│ tags (JSON)       │
│ created_by (FK)   │
│ updated_at        │
└─────────┬─────────┘
          │
          │ secret_id
          ▼
┌───────────────────┐
│  secret_history   │
├───────────────────┤
│ id (PK)           │
│ secret_id (FK)    │
│ version           │
│ ciphertext_blob   │
│ iv                │
│ changed_by (FK)   │
│ created_at        │
└───────────────────┘
```

## Data Flow

### Authentication Flow

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ Browser │     │ Worker  │     │ GitHub  │     │   D1    │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │
     │ GET /auth/github              │               │
     │──────────────►│               │               │
     │               │               │               │
     │  302 Redirect │               │               │
     │◄──────────────│               │               │
     │               │               │               │
     │ OAuth Flow    │               │               │
     │──────────────────────────────►│               │
     │               │               │               │
     │ Callback with code            │               │
     │◄──────────────────────────────│               │
     │               │               │               │
     │ POST /callback with code      │               │
     │──────────────►│               │               │
     │               │ Exchange code │               │
     │               │──────────────►│               │
     │               │ Access token  │               │
     │               │◄──────────────│               │
     │               │               │               │
     │               │ Get user info │               │
     │               │──────────────►│               │
     │               │ User data     │               │
     │               │◄──────────────│               │
     │               │               │               │
     │               │ Find/create user              │
     │               │──────────────────────────────►│
     │               │               │               │
     │               │ Generate JWT  │               │
     │               │               │               │
     │ { token, user }               │               │
     │◄──────────────│               │               │
```

### Secret Encryption Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│                                                              │
│  1. User enters secret data                                  │
│     { username: "user", password: "secret123" }              │
│                                                              │
│  2. Retrieve encrypted org key from memory/server            │
│     encrypted_org_key = "base64..."                          │
│                                                              │
│  3. Decrypt org key with user's private key                  │
│     org_key = RSA_DECRYPT(encrypted_org_key, private_key)    │
│                                                              │
│  4. Generate random IV                                       │
│     iv = crypto.getRandomValues(new Uint8Array(12))          │
│                                                              │
│  5. Encrypt secret data                                      │
│     ciphertext = AES_GCM_ENCRYPT(JSON.stringify(data),       │
│                                  org_key, iv)                │
│                                                              │
│  6. Send to server                                           │
│     POST /secrets { ciphertext: "base64...", iv: "base64..." }│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Server                                │
│                                                              │
│  - Receives only ciphertext + IV                             │
│  - Cannot decrypt (no access to org key)                     │
│  - Stores encrypted blob in D1                               │
│  - Logs audit event                                          │
└─────────────────────────────────────────────────────────────┘
```

### Key Exchange Flow (Adding New User)

```
┌─────────────┐           ┌─────────────┐           ┌─────────────┐
│   Admin     │           │   Server    │           │  New User   │
│  Browser    │           │             │           │   Browser   │
└──────┬──────┘           └──────┬──────┘           └──────┬──────┘
       │                         │                         │
       │ 1. Invite user@email    │                         │
       │────────────────────────►│                         │
       │                         │                         │
       │                         │ 2. Create pending       │
       │                         │    membership           │
       │                         │                         │
       │                         │ 3. Send invite email    │
       │                         │────────────────────────►│
       │                         │                         │
       │                         │   4. User registers     │
       │                         │◄────────────────────────│
       │                         │                         │
       │                         │   5. User generates     │
       │                         │      key pair           │
       │                         │                         │
       │                         │   6. Store public key   │
       │                         │◄────────────────────────│
       │                         │                         │
       │ 7. View pending user    │                         │
       │◄────────────────────────│                         │
       │                         │                         │
       │ 8. Approve user:        │                         │
       │    - Decrypt org key    │                         │
       │    - Re-encrypt for     │                         │
       │      user's public key  │                         │
       │────────────────────────►│                         │
       │                         │                         │
       │                         │ 9. Store encrypted      │
       │                         │    org key for user     │
       │                         │                         │
       │                         │ 10. Notify user         │
       │                         │────────────────────────►│
       │                         │                         │
       │                         │     User can now        │
       │                         │     access secrets      │
```

## Security Architecture

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRUSTED ZONE (User's Browser)                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  - Master password (user's memory)                       │   │
│  │  - Derived master key (runtime memory)                   │   │
│  │  - Decrypted private key (runtime memory)                │   │
│  │  - Decrypted org keys (runtime memory)                   │   │
│  │  - Plaintext secrets (runtime memory, DOM)               │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ══════════╪══════════  TRUST BOUNDARY
                              │
┌─────────────────────────────────────────────────────────────────┐
│                   UNTRUSTED ZONE (Server/Database)               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  - Encrypted private keys                                │   │
│  │  - Encrypted org keys                                    │   │
│  │  - Encrypted secrets (ciphertext only)                   │   │
│  │  - Public keys                                           │   │
│  │  - Salts                                                 │   │
│  │  - Audit logs                                            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### What The Server Knows

| Data | Server Has Access |
|------|-------------------|
| User emails | Yes |
| User public keys | Yes |
| Encrypted private keys | Yes (but can't decrypt) |
| Secret names | Yes (unencrypted for search) |
| Secret URLs | Yes (unencrypted for search) |
| Username hints | Yes (unencrypted for display) |
| Actual passwords | **No** |
| Organization keys | **No** |
| Master passwords | **No** |

## Performance Considerations

### Caching Strategy

- **JWT tokens**: Stored in localStorage, validated on each request
- **Organization keys**: Cached in memory after first decryption
- **User preferences**: Cached in React context
- **Secrets list**: Fetched fresh, not cached (security)

### Database Optimization

- Indexes on frequently queried columns
- Pagination for large datasets (audit logs)
- JSON columns for flexible data (tags)

### Frontend Optimization

- Code splitting (vendor chunk)
- Lazy loading for routes (future)
- Skeleton loaders for perceived performance
- Debounced search input

## Scalability

### Current Limits (Free Tier)

| Resource | Limit | Typical Usage |
|----------|-------|---------------|
| Worker requests | 100k/day | ~500/day for 20 users |
| D1 storage | 5GB | ~10MB for small org |
| D1 reads | 5M/day | ~5k/day |
| Pages bandwidth | Unlimited | Static assets |

### Future Scaling Options

1. **Cloudflare Pro**: Higher limits, analytics
2. **D1 replicas**: Read replicas for performance
3. **KV storage**: Cache frequently accessed data
4. **Durable Objects**: Real-time collaboration (future)

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Repository                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  main branch                                              │   │
│  │    │                                                      │   │
│  │    ├── Push triggers GitHub Actions                       │   │
│  │    │                                                      │   │
│  │    ▼                                                      │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  CI/CD Pipeline                                     │  │   │
│  │  │  1. Lint & Type Check                               │  │   │
│  │  │  2. Run Tests                                       │  │   │
│  │  │  3. Build Frontend                                  │  │   │
│  │  │  4. Deploy Worker → Cloudflare Workers              │  │   │
│  │  │  5. Deploy Frontend → Cloudflare Pages              │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```
