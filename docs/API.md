# CloudVault API Documentation

Base URL: `/api`

All endpoints (except auth) require a Bearer token in the Authorization header:
```
Authorization: Bearer <jwt_token>
```

## Authentication

### GitHub OAuth

#### GET `/auth/github`
Redirects to GitHub OAuth authorization page.

#### POST `/auth/github/callback`
Exchange GitHub authorization code for JWT token.

**Request Body:**
```json
{
  "code": "github_authorization_code"
}
```

**Response:**
```json
{
  "token": "jwt_token",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "publicKey": "base64_encoded_key",
    "encryptedPrivateKey": "base64_encoded_encrypted_key",
    "salt": "base64_encoded_salt",
    "authProvider": "github",
    "createdAt": "2024-01-01T00:00:00Z"
  },
  "isNewUser": false
}
```

### Magic Link

#### POST `/auth/magic-link`
Request a magic link email.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "message": "Magic link sent to user@example.com"
}
```

#### POST `/auth/magic-link/verify`
Verify magic link token and get JWT.

**Request Body:**
```json
{
  "token": "uuid_token"
}
```

**Response:** Same as GitHub callback.

### User Management

#### GET `/auth/me`
Get current authenticated user.

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "User Name",
  "publicKey": "base64_encoded_key",
  "encryptedPrivateKey": "base64_encoded_encrypted_key",
  "salt": "base64_encoded_salt",
  "authProvider": "github",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

#### POST `/auth/setup-keys`
Set up encryption keys for new user.

**Request Body:**
```json
{
  "publicKey": "base64_encoded_public_key",
  "encryptedPrivateKey": "base64_encoded_encrypted_private_key",
  "salt": "base64_encoded_salt"
}
```

---

## Organizations

#### GET `/organizations`
List user's organizations.

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "My Org",
    "role": "admin",
    "encryptedOrgKey": "base64_encoded_key",
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

#### POST `/organizations`
Create a new organization.

**Request Body:**
```json
{
  "name": "Organization Name",
  "encryptedOrgKey": "base64_encoded_key"
}
```

### Members

#### GET `/organizations/:orgId/members`
List organization members. Requires admin role.

**Response:**
```json
[
  {
    "userId": "uuid",
    "orgId": "uuid",
    "role": "admin",
    "encryptedOrgKey": "base64_encoded_key",
    "status": "active",
    "userEmail": "user@example.com",
    "userName": "User Name",
    "userPublicKey": "base64_encoded_key",
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

#### POST `/organizations/:orgId/members`
Invite a user. Requires admin role.

**Request Body:**
```json
{
  "email": "newuser@example.com"
}
```

#### POST `/organizations/:orgId/members/:userId/approve`
Approve pending user. Requires admin role.

**Request Body:**
```json
{
  "encryptedOrgKey": "base64_org_key_encrypted_for_user"
}
```

#### PATCH `/organizations/:orgId/members/:userId`
Update user role. Requires admin role.

**Request Body:**
```json
{
  "role": "member"  // "admin" | "member" | "read_only"
}
```

#### DELETE `/organizations/:orgId/members/:userId`
Remove user from organization. Requires admin role.

---

## Secrets

#### GET `/organizations/:orgId/secrets`
List secrets with optional filtering.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| categoryId | uuid | Filter by category |
| type | string | Filter by type (password, note, api_key, card) |
| favorites | boolean | Only show favorites |
| search | string | Search in name, URL, tags |

**Response:**
```json
[
  {
    "id": "uuid",
    "orgId": "uuid",
    "name": "Gmail",
    "url": "https://gmail.com",
    "usernameHint": "user@...",
    "ciphertextBlob": "base64_encrypted_data",
    "iv": "base64_iv",
    "version": 1,
    "createdBy": "uuid",
    "updatedAt": "2024-01-01T00:00:00Z",
    "categoryId": "uuid",
    "isFavorite": true,
    "secretType": "password",
    "expiresAt": "2025-01-01T00:00:00Z",
    "tags": ["email", "work"],
    "categoryName": "Email",
    "categoryColor": "#6366f1"
  }
]
```

#### GET `/organizations/:orgId/secrets/:secretId`
Get a single secret. Logs VIEW_SECRET audit event.

#### POST `/organizations/:orgId/secrets`
Create a new secret. Requires member role or higher.

**Request Body:**
```json
{
  "name": "Secret Name",
  "url": "https://example.com",
  "usernameHint": "user@...",
  "ciphertextBlob": "base64_encrypted_data",
  "iv": "base64_iv",
  "categoryId": "uuid",
  "secretType": "password",
  "tags": ["tag1", "tag2"],
  "expiresAt": "2025-01-01T00:00:00Z"
}
```

#### PUT `/organizations/:orgId/secrets/:secretId`
Update a secret. Creates history entry if ciphertext changes.

**Request Body:** Same as create, all fields optional.

#### PATCH `/organizations/:orgId/secrets/:secretId/favorite`
Toggle favorite status.

**Request Body:**
```json
{
  "isFavorite": true
}
```

#### DELETE `/organizations/:orgId/secrets/:secretId`
Delete a secret. Requires member role or higher.

#### GET `/organizations/:orgId/secrets/:secretId/history`
Get password history for a secret.

**Response:**
```json
[
  {
    "id": 1,
    "secretId": "uuid",
    "version": 1,
    "ciphertextBlob": "base64_encrypted_data",
    "iv": "base64_iv",
    "changedBy": "uuid",
    "changedByEmail": "user@example.com",
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

#### GET `/organizations/:orgId/secrets/expiring`
Get secrets expiring within 30 days.

---

## Categories

#### GET `/organizations/:orgId/categories`
List categories with secret counts.

**Response:**
```json
[
  {
    "id": "uuid",
    "orgId": "uuid",
    "name": "Email",
    "icon": "mail",
    "color": "#6366f1",
    "sortOrder": 0,
    "secretCount": 5,
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

#### POST `/organizations/:orgId/categories`
Create a category. Requires member role or higher.

**Request Body:**
```json
{
  "name": "Category Name",
  "icon": "folder",
  "color": "#6366f1"
}
```

#### PUT `/organizations/:orgId/categories/:categoryId`
Update a category.

#### DELETE `/organizations/:orgId/categories/:categoryId`
Delete a category. Requires admin role. Secrets are moved to uncategorized.

---

## User Preferences

#### GET `/preferences`
Get current user's preferences.

**Response:**
```json
{
  "theme": "system",
  "sessionTimeout": 15,
  "clipboardClear": 30,
  "showFavicons": true,
  "compactView": false
}
```

#### PUT `/preferences`
Update preferences.

**Request Body:** Any subset of preference fields.

---

## Audit Logs

#### GET `/organizations/:orgId/audit`
Get audit logs. Requires admin role.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| limit | number | Max results (default 50, max 100) |
| offset | number | Pagination offset |
| action | string | Filter by action type |
| userId | uuid | Filter by user |
| startDate | datetime | Filter from date |
| endDate | datetime | Filter to date |

**Response:**
```json
{
  "logs": [
    {
      "id": 1,
      "orgId": "uuid",
      "userId": "uuid",
      "userEmail": "user@example.com",
      "action": "VIEW_SECRET",
      "targetType": "secret",
      "targetId": "uuid",
      "targetName": "Gmail",
      "metadata": "{\"key\": \"value\"}",
      "ipAddress": "1.2.3.4",
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 100
}
```

**Action Types:**
- `CREATE_SECRET`, `VIEW_SECRET`, `UPDATE_SECRET`, `DELETE_SECRET`
- `VIEW_SECRET_HISTORY`
- `CREATE_CATEGORY`, `UPDATE_CATEGORY`, `DELETE_CATEGORY`
- `INVITE_USER`, `APPROVE_USER`, `REMOVE_USER`, `UPDATE_USER_ROLE`
- `CREATE_ORG`
- `CREATE_SHARE_LINK`, `REVOKE_SHARE_LINK`, `ACCESS_SHARE_LINK`
- `ADD_EMERGENCY_CONTACT`, `REMOVE_EMERGENCY_CONTACT`
- `EMERGENCY_ACCESS_REQUESTED`, `EMERGENCY_ACCESS_DENIED`
- `UPDATE_ORG_SETTINGS`

#### GET `/organizations/:orgId/audit/export`
Export audit logs as CSV.

---

## Secure Sharing

#### POST `/organizations/:orgId/secrets/:secretId/share`
Create a temporary share link for a secret.

**Request Body:**
```json
{
  "expiresInHours": 24,
  "maxViews": 1,
  "accessPassword": "optional-password",
  "allowCopy": true,
  "recipientEmail": "recipient@example.com"
}
```

**Response:**
```json
{
  "id": "uuid",
  "url": "https://app.example.com/share/uuid",
  "expiresAt": "2024-01-02T00:00:00Z",
  "maxViews": 1,
  "hasPassword": true,
  "allowCopy": true,
  "recipientEmail": "recipient@example.com"
}
```

#### GET `/organizations/:orgId/secrets/:secretId/shares`
List all share links for a secret.

#### DELETE `/organizations/:orgId/shares/:linkId`
Revoke a share link.

#### GET `/share/public/:linkId` (No Auth Required)
Get share link info before accessing.

#### POST `/share/public/:linkId/access` (No Auth Required)
Access shared secret with optional password.

---

## Emergency Access

#### GET `/organizations/:orgId/emergency-contacts`
List emergency contacts. Requires admin role.

#### POST `/organizations/:orgId/emergency-contacts`
Add an emergency contact.

**Request Body:**
```json
{
  "contactEmail": "trusted@example.com",
  "contactName": "Trusted Contact",
  "waitTimeHours": 48
}
```

#### DELETE `/organizations/:orgId/emergency-contacts/:contactId`
Remove an emergency contact.

#### GET `/organizations/:orgId/emergency-requests`
List emergency access requests. Requires admin role.

#### POST `/emergency/request/:contactId` (No Auth Required)
Request emergency access.

**Request Body:**
```json
{
  "reason": "Need access because admin is unavailable..."
}
```

#### POST `/organizations/:orgId/emergency-requests/:requestId/deny`
Deny an emergency access request.

---

## Organization Settings

#### GET `/organizations/:orgId/settings`
Get organization settings.

**Response:**
```json
{
  "require2fa": false,
  "minPasswordLength": 12,
  "passwordExpiryDays": 90,
  "allowShareLinks": true,
  "shareLinkMaxHours": 168,
  "allowEmergencyAccess": true,
  "emergencyWaitMinHours": 24,
  "auditRetentionDays": 365
}
```

#### PUT `/organizations/:orgId/settings`
Update organization settings. Requires admin role.

#### GET `/organizations/:orgId/health`
Get password health report.

**Response:**
```json
{
  "healthScore": 85,
  "totalSecrets": 50,
  "metrics": {
    "expiringSoon": 3,
    "expired": 1,
    "oldPasswords": 5
  },
  "expiringSecrets": [...],
  "oldPasswords": [...]
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "type": "validation",  // Optional, present for validation errors
  "code": "ERROR_CODE"   // Optional, present for specific error types
}
```

**HTTP Status Codes:**
| Code | Description |
|------|-------------|
| 400 | Bad Request / Validation Error |
| 401 | Unauthorized (missing/invalid/revoked token or session timeout) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 429 | Too Many Requests (rate limited) |
| 500 | Internal Server Error |

**Special Error Codes:**
| Code | Description |
|------|-------------|
| `SESSION_TIMEOUT` | User's session has timed out due to inactivity. Client should prompt for re-authentication. |

---

## Rate Limits

Rate limiting is distributed globally via Cloudflare KV, ensuring limits are enforced across all edge locations.

| Endpoint | Limit |
|----------|-------|
| Auth endpoints | 10 requests / minute |
| Magic link | 5 requests / 15 minutes |
| All other endpoints | 100 requests / minute |

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 60
```

When rate limited, the response includes a `Retry-After` header.
