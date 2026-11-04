# API reference

Base URL: `/api` on the Worker. Requests and responses are JSON. Authenticated routes need `Authorization: Bearer <token>`.

Errors look like:

```json
{ "error": "Human readable message", "code": "OPTIONAL_CODE" }
```

| Status | Meaning |
|--------|---------|
| 400 | Validation failed (`"type": "validation"`) or a bad request |
| 401 | Missing or invalid session. `code` is `SESSION_TIMEOUT` (idle) or `SESSION_ENDED` (revoked or expired) |
| 403 | Not a member, or the role is too low |
| 404 | Not found |
| 409 | Conflict (duplicate, `VERSION_CONFLICT`, `ROTATION_CONFLICT`) |
| 410 | Share link revoked, expired or used up |
| 429 | Rate limited (`Retry-After` header) |
| 503 | Server not configured |

Encodings: ciphertext is lowercase hex; IVs are 12 bytes as 24 hex characters; keys, salts and RSA-encrypted org keys are base64.

## Health

`GET /api/health` returns `{ "status": "ok", "timestamp": "..." }`.

## Auth (`/api/auth`)

Rate limited to 20 requests per minute per IP.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/config` | no | `{ github, magicLink, signupsAllowed }`: which sign-in methods exist |
| GET | `/github?state=...` | no | Redirects to GitHub. `state` is 16 to 128 URL-safe characters, generated and checked by the client |
| POST | `/github/callback` | no | `{ code }` returns a login response |
| POST | `/magic-link` | no | `{ email }`. Always answers with a generic message. Limited to 5 per 15 minutes per IP and 3 per address |
| POST | `/magic-link/verify` | no | `{ token }` (from the link's `#token=`) returns a login response. Single use |
| GET | `/me` | yes | Current user |
| PATCH | `/me` | yes | `{ name }` |
| POST | `/setup-keys` | yes | `{ publicKey, encryptedPrivateKey, salt, kdfIterations }`. Once only (409 afterwards) |
| PUT | `/keys` | yes | Change master password: `{ encryptedPrivateKey, salt, kdfIterations }`. Signs out other sessions |
| POST | `/logout` | yes | Revokes this session |
| POST | `/logout-all` | yes | Revokes every session: `{ sessionsRevoked }` |
| GET | `/session` | yes | `{ expiresAt, now }` (unix seconds) |

Login response:

```json
{
  "token": "eyJ...",
  "expiresAt": 1767225600,
  "user": {
    "id": "uuid", "email": "a@example.org", "name": "A",
    "publicKey": "base64|null", "encryptedPrivateKey": "base64|null", "salt": "base64|null",
    "kdfIterations": 600000, "authProvider": "github|magic_link", "createdAt": "..."
  },
  "needsKeySetup": false
}
```

## Organizations (`/api/organizations`)

All routes require a session. "Role" is the minimum role needed.

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/` | any user | `{ organizations: [{ id, name, role, encryptedOrgKey, keyVersion, createdAt }], pendingInvites: [{ id, name }] }` |
| POST | `/` | any user with keys | `{ name, encryptedOrgKey }` creates an org with you as admin |
| GET | `/:orgId` | read_only | Org details and your role |
| PATCH | `/:orgId` | admin | `{ name }` |
| DELETE | `/:orgId` | admin | Deletes the org and all its data atomically. Audit rows are kept |
| POST | `/:orgId/leave` | read_only | Leave. The last admin cannot leave |

### Members

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/:orgId/members` | read_only | Admins see pending invites too. Each: `{ userId, role, status, userEmail, userName, userPublicKey, hasKeys, createdAt }` |
| POST | `/:orgId/members` | admin | `{ email, role? }` creates a pending membership (and a placeholder user if needed). Emails an invite when Resend is configured |
| POST | `/:orgId/members/:userId/approve` | admin | `{ encryptedOrgKey }`: the org key encrypted for the member's public key. 409 if they have no keys yet |
| PATCH | `/:orgId/members/:userId` | admin | `{ role }`. You cannot change your own role; the last admin cannot be demoted |
| DELETE | `/:orgId/members/:userId` | admin | Remove a member or cancel an invite. Returns `{ recommendKeyRotation }` |

### Key rotation

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/:orgId/key-rotation` | admin | `{ keyVersion, secrets[], history[], members[{ userId, email, publicKey }], emergencyContacts[{ contactId, email, publicKey }] }` |
| POST | `/:orgId/key-rotation` | admin | `{ fromKeyVersion, secrets[{ id, ciphertextBlob, iv, encVersion }], history[{ id, ... }], memberKeys[{ userId, encryptedOrgKey }], emergencyKeys[{ contactId, encryptedOrgKey }] }`. Must cover exactly the current secrets, history, active members and contacts, else 409 `ROTATION_CONFLICT`. Applied atomically; returns `{ keyVersion }` |

## Secrets

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/:orgId/secrets` | read_only | Metadata only (no ciphertext). Filters: `?categoryId=`, `?type=`, `?favorites=true` |
| GET | `/:orgId/secrets/:id` | read_only | Full item with ciphertext. Audited as `VIEW_SECRET` |
| POST | `/:orgId/secrets` | member | Create (see body below). 201 |
| PUT | `/:orgId/secrets/:id` | member | Partial update. Send `expectedVersion` to get 409 `VERSION_CONFLICT` instead of overwriting someone else's change |
| DELETE | `/:orgId/secrets/:id` | member | Deletes the item, its history, favorites and share links |
| PATCH | `/:orgId/secrets/:id/favorite` | read_only | `{ isFavorite }` (per user) |
| GET | `/:orgId/secrets/:id/history` | read_only | Previous versions (newest 20), with `changedByEmail`. Audited |
| GET | `/:orgId/secrets/expiring` | read_only | Items expiring within 30 days or already expired |
| GET | `/:orgId/secrets/export` | read_only | `{ version, exportedAt, orgId, secrets: [full items] }`. Audited |
| POST | `/:orgId/secrets/import` | member | `{ secrets: [create bodies, 1 to 500], categoryId? }` in one statement. 201 `{ imported, ids }` |

Create body:

```json
{
  "id": "client-generated uuid (required when encVersion is 2)",
  "name": "Bank",
  "url": "https://bank.example (http/https only)",
  "usernameHint": "treasurer@example.org",
  "ciphertextBlob": "hex",
  "iv": "24 hex chars",
  "encVersion": 2,
  "categoryId": "uuid|null",
  "secretType": "password|note|api_key|card|totp",
  "tags": ["finance"],
  "expiresAt": "2027-01-01T00:00:00Z|null"
}
```

When the ciphertext changes, the version is incremented and the previous ciphertext moves to history.

## Categories

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/:orgId/categories` | read_only | With `secretCount` |
| POST | `/:orgId/categories` | member | `{ name, icon?, color? }` (icon `[a-z0-9-]`, color `#rrggbb`) |
| PUT | `/:orgId/categories/:id` | member | `{ name?, icon?, color?, sortOrder? }` |
| DELETE | `/:orgId/categories/:id` | admin | Items in it become uncategorized |

## Share links

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/:orgId/secrets/:id/shares` | member | `{ id, ciphertextBlob, iv, expiresInHours, maxViews, allowCopy, recipientEmail?, accessSalt?, accessVerifier? }`. The client encrypts a copy of the item with a one-off key that stays in the URL fragment. `accessVerifier` is SHA-256 (hex) of the client-derived password token |
| GET | `/:orgId/secrets/:id/shares` | read_only | Links for an item, with status and view counts |
| DELETE | `/:orgId/shares/:linkId` | member | Revoke and delete its ciphertext |

Public (no auth, 30 requests per 5 minutes per IP):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/share/:linkId` | `{ secretName, orgName, requiresPassword, accessSalt, allowCopy, expiresAt, remainingViews }`. Does not use a view |
| POST | `/api/share/:linkId/access` | `{ accessToken? }`. Uses one view (atomically) and returns `{ name, url, secretType, ciphertextBlob, iv, allowCopy, remainingViews }`. 401 `PASSWORD_REQUIRED` / `PASSWORD_INCORRECT`; 410 when no longer available |

## Settings and health

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/:orgId/settings` | read_only | `{ minPasswordLength, passwordExpiryDays, allowShareLinks, shareLinkMaxHours, allowEmergencyAccess, emergencyWaitMinHours, auditRetentionDays }` |
| PUT | `/:orgId/settings` | admin | Any subset of the above |
| GET | `/:orgId/health` | read_only | `{ healthScore, totalSecrets, metrics: { expiringSoon, expired, oldPasswords }, expiringSecrets[], oldPasswords[] }` |

## Audit log (admins)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/:orgId/audit` | `?limit=1..100&offset=&action=&userId=&startDate=&endDate=` returns `{ logs[], total }` |
| GET | `/:orgId/audit/export` | CSV download (formula-safe) |
| GET | `/:orgId/audit/stats` | `{ actionCounts, topUsers, last7Days }` |

Actions: `LOGIN`, `LOGOUT`, `LOGOUT_ALL`, `SETUP_KEYS`, `CHANGE_MASTER_PASSWORD`, `UPDATE_PROFILE`, `VIEW_SECRET`, `CREATE_SECRET`, `UPDATE_SECRET`, `DELETE_SECRET`, `VIEW_SECRET_HISTORY`, `IMPORT_SECRETS`, `EXPORT_SECRETS`, `CREATE_ORG`, `UPDATE_ORG`, `DELETE_ORG`, `UPDATE_ORG_SETTINGS`, `ROTATE_ORG_KEY`, `INVITE_USER`, `APPROVE_USER`, `REMOVE_USER`, `LEAVE_ORG`, `UPDATE_USER_ROLE`, `CREATE_CATEGORY`, `UPDATE_CATEGORY`, `DELETE_CATEGORY`, `CREATE_SHARE_LINK`, `REVOKE_SHARE_LINK`, `ACCESS_SHARE_LINK`, `ADD_EMERGENCY_CONTACT`, `REMOVE_EMERGENCY_CONTACT`, `EMERGENCY_ACCESS_REQUESTED`, `EMERGENCY_ACCESS_APPROVED`, `EMERGENCY_ACCESS_DENIED`, `EMERGENCY_ACCESS_GRANTED`, `VIEW_AUDIT_LOG`, `EXPORT_AUDIT_LOG`.

## Emergency access

Admin routes under `/api/organizations`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/:orgId/emergency-contacts` | Active contacts |
| GET | `/:orgId/emergency-contacts/lookup?email=` | `{ userId, email, name, publicKey }` for an existing user with keys |
| POST | `/:orgId/emergency-contacts` | `{ contactEmail, contactName?, waitTimeHours, encryptedOrgKey }` (org key encrypted for the contact's public key) |
| DELETE | `/:orgId/emergency-contacts/:id` | Revoke; open requests are denied |
| GET | `/:orgId/emergency-requests` | Requests with status and `canRespond` |
| POST | `/:orgId/emergency-requests/:id/approve` | Grant now (from `pending`) |
| POST | `/:orgId/emergency-requests/:id/deny` | Deny (from `pending` or `approved`) |

Contact routes under `/api/emergency` (authenticated as the contact):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/access` | Orgs where you are a contact, with the latest request |
| POST | `/access/:contactId/request` | `{ reason }` (10 to 500 characters). Emails the org's admins |
| POST | `/access/requests/:id/claim` | After the wait (or approval): creates a read-only membership with the escrowed key. 403 `WAITING_PERIOD` if too early |

## Preferences (`/api/preferences`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | `{ theme, sessionTimeout, clipboardClear, showFavicons, compactView }` |
| PUT | `/` | Any subset. `sessionTimeout` (minutes, 0 = never, max 1440) also applies to live sessions |
