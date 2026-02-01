# CloudVault Security Documentation

## Overview

CloudVault implements a **zero-knowledge architecture** where the server never has access to plaintext secrets. All encryption and decryption happens client-side in the browser using the Web Crypto API.

## Cryptographic Design

### Key Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                     Master Password                          │
│                    (User's brain)                            │
└─────────────────────┬───────────────────────────────────────┘
                      │ PBKDF2 (100,000 iterations)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Master Key (AES-256)                      │
│              (Derived, never stored)                         │
└─────────────────────┬───────────────────────────────────────┘
                      │ Encrypts
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              User Private Key (RSA-OAEP)                     │
│           (Stored encrypted on server)                       │
└─────────────────────┬───────────────────────────────────────┘
                      │ Decrypts
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Organization Key (AES-256-GCM)                  │
│    (Encrypted with each user's public key, stored)          │
└─────────────────────┬───────────────────────────────────────┘
                      │ Encrypts
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Secret Data                               │
│              (Stored as ciphertext)                          │
└─────────────────────────────────────────────────────────────┘
```

### Algorithms Used

| Purpose | Algorithm | Key Size |
|---------|-----------|----------|
| Key Derivation | PBKDF2-SHA256 | 256-bit |
| User Identity | RSA-OAEP | 4096-bit |
| Secret Encryption | AES-256-GCM | 256-bit |
| Random Generation | `crypto.getRandomValues()` | N/A |

### Key Generation

**Master Key Derivation:**
```javascript
// PBKDF2 with 100,000 iterations
const masterKey = await crypto.subtle.deriveKey(
  {
    name: 'PBKDF2',
    salt: crypto.getRandomValues(new Uint8Array(16)),
    iterations: 100000,
    hash: 'SHA-256'
  },
  passwordKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
);
```

**RSA Key Pair:**
```javascript
const keyPair = await crypto.subtle.generateKey(
  {
    name: 'RSA-OAEP',
    modulusLength: 4096,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256'
  },
  true,
  ['encrypt', 'decrypt']
);
```

**Organization Key:**
```javascript
const orgKey = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 },
  true,
  ['encrypt', 'decrypt']
);
```

## Data Flow

### User Registration

1. User authenticates via GitHub OAuth or Magic Link
2. Browser generates RSA-4096 key pair
3. Browser derives master key from chosen password (PBKDF2)
4. Private key encrypted with master key, stored on server
5. Public key stored unencrypted on server
6. Salt stored on server (needed for key derivation)

### Creating an Organization

1. Browser generates AES-256 organization key
2. Org key encrypted with creator's public key
3. Encrypted org key stored in membership record

### Adding a User

1. Admin invites user by email
2. User creates account, generates key pair
3. Admin's browser:
   - Decrypts org key with their private key
   - Re-encrypts org key with new user's public key
4. New encrypted org key stored for the user

### Encrypting a Secret

1. Browser retrieves encrypted org key
2. Browser decrypts org key using user's private key
3. Secret data serialized to JSON
4. Browser generates random 96-bit IV
5. Secret encrypted with org key (AES-256-GCM)
6. Ciphertext + IV sent to server

### Decrypting a Secret

1. Browser retrieves ciphertext + IV from server
2. Browser decrypts org key (if not cached)
3. Browser decrypts secret with org key
4. Plaintext never leaves browser memory

## Security Features

### Transport Security

- **HTTPS Only**: All traffic encrypted via TLS 1.3
- **HSTS**: Strict-Transport-Security header enforced
- **Certificate Pinning**: Cloudflare handles certificate management

### HTTP Security Headers

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-XSS-Protection: 1; mode=block
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

### Authentication

- **JWT Tokens**: 7-day expiry, signed with HS256, includes unique JTI for revocation
- **Token Blacklist**: Logout immediately invalidates tokens via Cloudflare KV blacklist
- **Distributed Rate Limiting**: Global rate limiting via Cloudflare KV (not per-isolate)
  - Auth endpoints: 10 requests/minute
  - Magic link requests: 5 requests/15 minutes
  - General API: 100 requests/minute
- **Magic Link Expiry**: 15 minutes, single use

### Session Security

- **Server-Enforced Timeout**: Session timeout checked server-side on every request
- **Configurable Duration**: Users can set timeout from 1-120 minutes (0 = never)
- **Activity Tracking**: Last activity timestamp stored in Cloudflare KV
- **Auto-Lock**: Vault locks after configurable inactivity (default 15 min)
- **Visibility Lock**: Can lock when tab becomes hidden
- **Manual Lock**: User can lock at any time

### Clipboard Security

- **Auto-Clear**: Clipboard cleared 30 seconds after copy (configurable)
- **Verification**: Only clears if clipboard still contains copied password

### Audit Trail

Every sensitive action is logged:
- Who performed the action
- What was affected
- When it happened
- IP address and user agent

Audit logs are immutable and cannot be deleted by users.

## Threat Model

### What We Protect Against

| Threat | Mitigation |
|--------|------------|
| Server breach | Zero-knowledge: server only has ciphertext |
| Database leak | All secrets encrypted, keys not stored |
| Man-in-the-middle | HTTPS + HSTS |
| XSS | CSP headers, React's built-in escaping |
| CSRF | SameSite cookies, custom headers |
| Brute force | Distributed rate limiting, PBKDF2 key stretching |
| Session hijacking | Token blacklist, server-enforced timeout |
| Stolen token | JWT blacklist invalidates on logout |
| Insider threat | Audit logging, role-based access |

### What We Don't Protect Against

| Threat | Reason |
|--------|--------|
| Compromised browser | If attacker controls browser, game over |
| Keyloggers | Master password can be captured |
| Screen capture | Decrypted passwords visible on screen |
| Memory forensics | Keys exist in memory during session |
| Weak master password | User responsibility |

## Security Best Practices for Users

1. **Use a strong master password** (16+ characters, random)
2. **Don't reuse your master password** anywhere else
3. **Enable auto-lock** for when you step away
4. **Review audit logs** regularly for suspicious activity
5. **Revoke access** for departing members immediately
6. **Use unique passwords** for each secret (use the generator)

## Incident Response

### If You Suspect a Breach

1. **Lock vault** immediately
2. **Review audit logs** for unauthorized access
3. **Change master password** if compromised
4. **Rotate org key** (requires re-encrypting all secrets)
5. **Remove suspicious users** from organization
6. **Notify affected parties** if credentials were exposed

### If Server is Compromised

Even if an attacker obtains the database:
- They only have encrypted blobs
- Master passwords are not stored
- Private keys are encrypted
- Brute-forcing is computationally infeasible

## Compliance Considerations

CloudVault's zero-knowledge architecture supports compliance with:

- **GDPR**: User data encrypted, audit trail available
- **HIPAA**: Encryption at rest and in transit
- **SOC 2**: Access controls, audit logging
- **PCI-DSS**: Encryption of cardholder data (if storing cards)

Note: Full compliance requires additional organizational controls beyond the software.

## Security Contact

To report security vulnerabilities, please open a private security advisory on GitHub or email the repository maintainer with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We aim to respond within 48 hours and will work with you on responsible disclosure.
