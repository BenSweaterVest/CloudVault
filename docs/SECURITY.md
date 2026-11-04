# Security model

CloudVault is designed so that the server (and anyone who obtains its database) only holds ciphertext. This document describes the cryptography, what is and is not protected, and the operational advice that goes with it.

## Key hierarchy

```
Master password (only in the user's head)
  │ PBKDF2-SHA256, per-user salt, per-user iteration count (600,000 for new keys)
  ▼
Wrapping key (AES-256-GCM, derived in the browser, never stored)
  │ encrypts
  ▼
User private key (RSA-OAEP SHA-256, 3072-bit for new users; stored encrypted)
  │ decrypts
  ▼
Organization key (AES-256-GCM; one RSA-encrypted copy per member)
  │ encrypts
  ▼
Items (AES-256-GCM, 96-bit random IV, associated data binds org and item id)
```

| Purpose | Algorithm |
|---------|-----------|
| Master password stretching | PBKDF2-SHA256, 600,000 iterations (older accounts: 100,000 until the password is changed) |
| User identity | RSA-OAEP with SHA-256, 3072-bit (older accounts: 2048-bit) |
| Organization key and items | AES-256-GCM |
| Item binding | AES-GCM associated data `cloudvault:secret:v2:<orgId>:<itemId>` |
| Share links | AES-256-GCM with a random one-off key, associated data bound to the link id |
| Share link password | PBKDF2-SHA256 (300,000 iterations) in the browser; server stores only SHA-256 of the derived token |
| Encrypted backups | PBKDF2-SHA256 (600,000) + AES-256-GCM |
| Randomness | `crypto.getRandomValues` |

All cryptography uses the browser's Web Crypto API. There are no third-party crypto libraries.

### Item formats

`enc_version = 1` items (created before 0.3.0) were encrypted without associated data and remain readable. Every write since 0.3.0 uses format 2. Rotating the org key re-encrypts everything into format 2.

## Flows

**Sign-up.** The user authenticates (GitHub or magic link), picks a master password, and the browser generates a key pair, wraps the private key, and uploads the public key, wrapped private key, salt and iteration count.

**Unlock.** The browser downloads the wrapped private key and unwraps it with the master password. Keys exist only in memory. Locking, signing out, idle timeout or reloading the page discards them.

**Joining an organization.** An admin invites an email address. After the person signs in and sets up keys, the admin opens the approval dialog, which shows a fingerprint of the person's public key (first 16 bytes of SHA-256 of the SPKI, in eight groups of four hex digits). The person reads the fingerprint from their own Preferences page. That fingerprint is derived from their private key on their device, not from the server's copy. The admin approves only if the two match; the admin's browser then encrypts the org key for that public key.

This check is what stops a malicious or compromised server from substituting its own public key and receiving the org key. If it is skipped, zero-knowledge holds only as long as the server is honest.

**Removing a member.** Their copy of the org key is deleted, but they may have kept the key or anything they viewed. The UI offers an **org key rotation** immediately. The admin's browser generates a new org key, re-encrypts every item and every history entry, re-encrypts the new key for every remaining member and emergency contact, and commits all of it in one atomic request. If anything changed during rotation, the server rejects the commit and the browser retries. Passwords the removed person saw should still be changed at their source.

**Share links.** The sharer's browser decrypts the item, encrypts a copy under a fresh random key, and uploads only that copy. The link is `https://app/share/<id>#<key>`. Browsers never send the fragment to servers, and the share page removes it from the address bar after reading it. A link can expire, be limited to N views (counted atomically), require a password, and be revoked (which deletes its ciphertext). Every access is audited.

**Emergency access.** An admin names an existing CloudVault user as an emergency contact after checking their fingerprint, and the admin's browser escrows the org key encrypted for that user's public key. If the contact requests access, all admins are emailed. After the waiting period (or an early approval), the contact can claim a read-only membership using the escrowed key. Admins can deny at any time before the claim. Escrowed keys are refreshed by key rotation; a stale key cannot be claimed.

## Server-side protections

- **Sessions.** HS256 JWTs whose `jti` refers to a row in D1. That row enforces revocation (logout, sign out everywhere, master password change), absolute expiry (7 days) and the user's idle timeout.
- **Login.** GitHub sign-in only trusts a verified primary email and matches on GitHub id first, so an unverified address can never take over an account. OAuth `state` is checked by the browser. Magic links are 256-bit random tokens, stored as SHA-256 hashes, valid once (atomic consume), 15 minutes by default, and delivered in the URL fragment.
- **Invite-only mode.** Set `ALLOW_SIGNUPS=false` so only people an admin has invited can sign in.
- **Authorization.** Every org route checks the caller's active membership and minimum role. An org always keeps at least one admin.
- **Validation.** Every request body is validated with Zod: sizes, hex/base64 formats, http(s)-only URLs, enum roles.
- **Rate limiting.** D1-backed, atomic fixed windows on login (20/min/IP), magic links (5/15 min/IP and 3/15 min/address) and public share access (30/5 min/IP). An in-memory limiter covers authenticated routes.
- **Headers.** The API sends `Cache-Control: no-store`, `default-src 'none'` CSP, HSTS, `nosniff`, `frame-ancestors 'none'`. The frontend build emits a Pages `_headers` file with a strict CSP whose `connect-src` is limited to the app and API origins. CORS allows only `APP_URL` (and localhost during development).
- **Audit log.** Sign-ins, item views (the list returns metadata only, so viewing an item requires an audited fetch), edits, deletes, exports, share link creation and access, membership changes, key rotation and emergency access. Retention is configurable per org and enforced daily. Exported CSVs neutralize spreadsheet formulas.

## Threat model

| Threat | Mitigation |
|--------|------------|
| Database or backup leak | Only ciphertext, wrapped keys, hashed tokens and metadata are stored |
| Malicious server substituting a public key | Fingerprint verification before approving members and emergency contacts |
| Server swapping ciphertext between items | AES-GCM associated data (format 2) |
| Removed member keeps the org key | Key rotation |
| Stolen session token | Idle timeout, revocation, sign out everywhere; it still cannot decrypt without the master password |
| Account takeover through GitHub email | Verified primary email only, GitHub id matched first |
| Brute force on login or share passwords | Rate limits; slow KDFs on the client |
| XSS | React escaping, strict CSP, http(s)-only links, no `dangerouslySetInnerHTML` |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` |
| Insider misuse | Roles, per-view audit log, CSV export |

### What CloudVault does not protect against

| Threat | Why |
|--------|-----|
| A compromised browser, extension or device | The attacker sees what you see, including the master password as you type it |
| A malicious frontend served by a compromised host | Any web-delivered crypto app trusts the code it is served. Host the frontend on infrastructure you control, and protect your Cloudflare account with strong 2FA |
| Weak master passwords | The setup screen requires 12+ characters and rejects weak choices, but cannot stop a guessable one |
| Metadata | Item names, websites, usernames, categories, tags and expiry dates are visible to the server |
| Forgotten master password | There is no recovery. An admin can re-invite the person after they create a new key. |
| Someone a share link was sent to | Anyone with the full link (and password, if set) can open it until it expires or runs out of views |

## Operational advice

1. Use a long, unique master password (four or more random words works well).
2. Always do the fingerprint check before approving anyone.
3. After removing someone, rotate the org key and change the passwords they used.
4. Review the audit log regularly; export it for board records.
5. Turn on `ALLOW_SIGNUPS=false` once your team is set up.
6. Keep an encrypted backup (Import / Export) somewhere safe.
7. Protect the Cloudflare and GitHub accounts that deploy CloudVault with hardware-key 2FA. Whoever controls them controls the code your browser runs.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security tab, "Report a vulnerability") with steps to reproduce and the impact. We aim to respond within a few days.
