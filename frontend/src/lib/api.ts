/**
 * CloudVault API client.
 *
 * All requests go through `request()`, which attaches the session token,
 * parses errors into ApiError, and announces ended sessions so the app can
 * return to the login screen.
 *
 * The API base URL comes from VITE_API_URL (for a Worker on another domain)
 * and defaults to /api (same origin, or the Vite dev proxy).
 */

import type { EncryptedSecret } from './crypto';

export const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

const TOKEN_KEY = 'cloudvault_token';

/** Fired on window when the server says the session is over. */
export const SESSION_ENDED_EVENT = 'cloudvault:session-ended';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // storage unavailable: the session lasts for this page only
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
  },
};

// ============================================
// TYPES
// ============================================

export type Role = 'admin' | 'member' | 'read_only';
export type SecretType = 'password' | 'note' | 'api_key' | 'card' | 'totp';

export interface User {
  id: string;
  email: string;
  name: string | null;
  publicKey: string | null;
  encryptedPrivateKey: string | null;
  salt: string | null;
  kdfIterations: number;
  authProvider: 'github' | 'magic_link';
  createdAt: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: number;
  user: User;
  needsKeySetup: boolean;
}

export interface Organization {
  id: string;
  name: string;
  role: Role;
  encryptedOrgKey: string;
  keyVersion: number;
  createdAt: string;
}

export interface OrganizationList {
  organizations: Organization[];
  pendingInvites: Array<{ id: string; name: string }>;
}

/** Secret metadata, as returned by the list endpoint (no ciphertext). */
export interface SecretMeta {
  id: string;
  orgId: string;
  name: string;
  url: string | null;
  usernameHint: string | null;
  version: number;
  createdBy: string | null;
  updatedAt: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  isFavorite: boolean;
  secretType: SecretType;
  expiresAt: string | null;
  tags: string[];
}

/** A secret with its ciphertext (single fetch, export, create, update). */
export interface Secret extends SecretMeta {
  ciphertextBlob: string;
  iv: string;
  encVersion: 1 | 2;
}

export interface SecretInput {
  name: string;
  url?: string;
  usernameHint?: string;
  categoryId?: string | null;
  secretType?: SecretType;
  tags?: string[];
  expiresAt?: string | null;
}

export interface SecretHistory {
  id: number;
  secretId: string;
  version: number;
  ciphertextBlob: string;
  iv: string;
  encVersion: 1 | 2;
  changedBy: string | null;
  changedByEmail: string | null;
  createdAt: string;
}

export interface Category {
  id: string;
  orgId: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  secretCount: number;
  createdAt: string;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  sessionTimeout: number;
  clipboardClear: number;
  showFavicons: boolean;
  compactView: boolean;
}

export interface AuditLogEntry {
  id: number;
  orgId: string | null;
  userId: string | null;
  userEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: string;
}

export interface Membership {
  userId: string;
  orgId: string;
  role: Role;
  status: 'pending' | 'active';
  userEmail: string;
  userName: string | null;
  userPublicKey: string | null;
  hasKeys: boolean;
  createdAt: string;
}

export interface ShareLink {
  id: string;
  url: string;
  expiresAt: string;
  maxViews: number;
  viewCount: number;
  allowCopy: boolean;
  recipientEmail: string | null;
  isRevoked: boolean;
  isExpired?: boolean;
  isExhausted?: boolean;
  hasPassword: boolean;
  createdAt?: string;
  lastViewedAt?: string | null;
  createdByEmail?: string | null;
}

export interface PublicShareInfo {
  secretName: string;
  orgName: string;
  requiresPassword: boolean;
  accessSalt: string | null;
  allowCopy: boolean;
  expiresAt: string;
  remainingViews: number | null;
}

export interface PublicShareContent {
  name: string;
  url: string | null;
  secretType: SecretType;
  ciphertextBlob: string;
  iv: string;
  allowCopy: boolean;
  remainingViews: number | null;
}

export interface OrgSettings {
  minPasswordLength: number;
  passwordExpiryDays: number;
  allowShareLinks: boolean;
  shareLinkMaxHours: number;
  allowEmergencyAccess: boolean;
  emergencyWaitMinHours: number;
  auditRetentionDays: number;
}

export interface HealthReport {
  healthScore: number;
  totalSecrets: number;
  metrics: { expiringSoon: number; expired: number; oldPasswords: number };
  expiringSecrets: Array<{ id: string; name: string; expiresAt: string; secretType: SecretType; daysUntilExpiry: number }>;
  oldPasswords: Array<{ id: string; name: string; lastUpdated: string; daysSinceUpdate: number }>;
}

export interface EmergencyContact {
  id: string;
  contactEmail: string;
  contactName: string | null;
  contactUserId: string;
  waitTimeHours: number;
  createdByEmail?: string | null;
  createdAt?: string;
}

export interface EmergencyRequest {
  id: string;
  requestedAt: string;
  grantAt: string;
  status: 'pending' | 'approved' | 'denied' | 'granted' | 'expired';
  reason: string | null;
  contactEmail: string;
  contactName: string | null;
  waitTimeHours: number;
  resolvedAt: string | null;
  resolvedByEmail: string | null;
  canRespond: boolean;
}

export interface EmergencyAccessEntry {
  contactId: string;
  orgId: string;
  orgName: string;
  waitTimeHours: number;
  request: { id: string; status: EmergencyRequest['status']; requestedAt: string; grantAt: string } | null;
}

export interface KeyRotationData {
  keyVersion: number;
  secrets: Array<{ id: string; ciphertextBlob: string; iv: string; encVersion: 1 | 2 }>;
  history: Array<{ id: number; secretId: string; ciphertextBlob: string; iv: string; encVersion: 1 | 2 }>;
  members: Array<{ userId: string; email: string; publicKey: string }>;
  emergencyContacts: Array<{ contactId: string; email: string; publicKey: string }>;
}

// ============================================
// CORE
// ============================================

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const SESSION_CODES = new Set(['SESSION_TIMEOUT', 'SESSION_ENDED']);

async function request<T>(endpoint: string, options: RequestInit & { json?: unknown; raw?: boolean } = {}): Promise<T> {
  const { json, raw, ...init } = options;
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (json !== undefined) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...init,
      headers,
      body: json !== undefined ? JSON.stringify(json) : init.body,
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string } & Record<string, unknown>;
    const error = new ApiError(response.status, body.error || `Request failed (${response.status})`, body.code, body);
    // 401s from public endpoints (wrong share password) say nothing about our session.
    const sessionEnded = SESSION_CODES.has(body.code ?? '') || (!body.code && !endpoint.startsWith('/share/') && endpoint !== '/auth/logout');
    if (response.status === 401 && token && sessionEnded) {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: { code: body.code } }));
    }
    throw error;
  }

  if (raw) return response as unknown as T;
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const org = (orgId: string) => `/organizations/${encodeURIComponent(orgId)}`;

// ============================================
// AUTH
// ============================================

export const authApi = {
  /** Full URL to start GitHub OAuth with the given state. */
  githubAuthUrl(state: string): string {
    return `${API_BASE}/auth/github?state=${encodeURIComponent(state)}`;
  },
  githubCallback: (code: string) => request<LoginResponse>('/auth/github/callback', { method: 'POST', json: { code } }),
  requestMagicLink: (email: string) => request<{ message: string }>('/auth/magic-link', { method: 'POST', json: { email } }),
  verifyMagicLink: (token: string) => request<LoginResponse>('/auth/magic-link/verify', { method: 'POST', json: { token } }),
  getCurrentUser: () => request<User>('/auth/me'),
  updateProfile: (name: string | null) => request<User>('/auth/me', { method: 'PATCH', json: { name } }),
  setupKeys: (data: { publicKey: string; encryptedPrivateKey: string; salt: string; kdfIterations: number }) =>
    request<User>('/auth/setup-keys', { method: 'POST', json: data }),
  changeMasterPassword: (data: { encryptedPrivateKey: string; salt: string; kdfIterations: number }) =>
    request<User>('/auth/keys', { method: 'PUT', json: data }),
  async logout(): Promise<void> {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch {
      // The local session is cleared regardless.
    } finally {
      tokenStore.clear();
    }
  },
  logoutAll: () => request<{ sessionsRevoked: number }>('/auth/logout-all', { method: 'POST' }),
};

// ============================================
// ORGANIZATIONS AND MEMBERS
// ============================================

export const orgsApi = {
  list: () => request<OrganizationList>('/organizations'),
  create: (data: { name: string; encryptedOrgKey: string }) => request<Organization>('/organizations', { method: 'POST', json: data }),
  rename: (orgId: string, name: string) => request<{ name: string }>(org(orgId), { method: 'PATCH', json: { name } }),
  delete: (orgId: string) => request<{ success: boolean }>(org(orgId), { method: 'DELETE' }),
  leave: (orgId: string) => request<{ success: boolean }>(`${org(orgId)}/leave`, { method: 'POST' }),
  getMembers: (orgId: string) => request<Membership[]>(`${org(orgId)}/members`),
  inviteUser: (orgId: string, email: string, role: Role = 'member') =>
    request<Membership & { invitationEmailed: boolean }>(`${org(orgId)}/members`, { method: 'POST', json: { email, role } }),
  approveUser: (orgId: string, userId: string, encryptedOrgKey: string) =>
    request<Membership>(`${org(orgId)}/members/${userId}/approve`, { method: 'POST', json: { encryptedOrgKey } }),
  updateRole: (orgId: string, userId: string, role: Role) =>
    request<{ role: Role }>(`${org(orgId)}/members/${userId}`, { method: 'PATCH', json: { role } }),
  removeUser: (orgId: string, userId: string) =>
    request<{ recommendKeyRotation: boolean }>(`${org(orgId)}/members/${userId}`, { method: 'DELETE' }),
  getKeyRotationData: (orgId: string) => request<KeyRotationData>(`${org(orgId)}/key-rotation`),
  commitKeyRotation: (
    orgId: string,
    data: {
      fromKeyVersion: number;
      secrets: Array<{ id: string } & EncryptedSecret>;
      history: Array<{ id: number } & EncryptedSecret>;
      memberKeys: Array<{ userId: string; encryptedOrgKey: string }>;
      emergencyKeys: Array<{ contactId: string; encryptedOrgKey: string }>;
    }
  ) => request<{ keyVersion: number }>(`${org(orgId)}/key-rotation`, { method: 'POST', json: data }),
};

// ============================================
// SECRETS
// ============================================

export const secretsApi = {
  list: (orgId: string) => request<SecretMeta[]>(`${org(orgId)}/secrets`),
  /** Fetch one secret with ciphertext. Recorded as a view in the audit log. */
  get: (orgId: string, secretId: string) => request<Secret>(`${org(orgId)}/secrets/${secretId}`),
  create: (orgId: string, data: SecretInput & EncryptedSecret & { id: string }) =>
    request<Secret>(`${org(orgId)}/secrets`, { method: 'POST', json: data }),
  update: (orgId: string, secretId: string, data: Partial<SecretInput> & Partial<EncryptedSecret> & { expectedVersion?: number }) =>
    request<Secret>(`${org(orgId)}/secrets/${secretId}`, { method: 'PUT', json: data }),
  delete: (orgId: string, secretId: string) => request<{ success: boolean }>(`${org(orgId)}/secrets/${secretId}`, { method: 'DELETE' }),
  toggleFavorite: (orgId: string, secretId: string, isFavorite: boolean) =>
    request<{ isFavorite: boolean }>(`${org(orgId)}/secrets/${secretId}/favorite`, { method: 'PATCH', json: { isFavorite } }),
  getHistory: (orgId: string, secretId: string) => request<SecretHistory[]>(`${org(orgId)}/secrets/${secretId}/history`),
  export: (orgId: string) => request<{ version: string; exportedAt: string; orgId: string; secrets: Secret[] }>(`${org(orgId)}/secrets/export`),
  import: (orgId: string, secrets: Array<SecretInput & EncryptedSecret & { id: string }>, categoryId?: string | null) =>
    request<{ imported: number; ids: string[] }>(`${org(orgId)}/secrets/import`, { method: 'POST', json: { secrets, categoryId } }),
};

// ============================================
// CATEGORIES
// ============================================

export const categoriesApi = {
  list: (orgId: string) => request<Category[]>(`${org(orgId)}/categories`),
  create: (orgId: string, data: { name: string; icon?: string; color?: string }) =>
    request<Category>(`${org(orgId)}/categories`, { method: 'POST', json: data }),
  update: (orgId: string, categoryId: string, data: Partial<{ name: string; icon: string; color: string; sortOrder: number }>) =>
    request<Category>(`${org(orgId)}/categories/${categoryId}`, { method: 'PUT', json: data }),
  delete: (orgId: string, categoryId: string) => request<{ success: boolean }>(`${org(orgId)}/categories/${categoryId}`, { method: 'DELETE' }),
};

// ============================================
// PREFERENCES
// ============================================

export const preferencesApi = {
  get: () => request<UserPreferences>('/preferences'),
  update: (data: Partial<UserPreferences>) => request<UserPreferences>('/preferences', { method: 'PUT', json: data }),
};

// ============================================
// AUDIT
// ============================================

export const auditApi = {
  list: (orgId: string, params: { limit?: number; offset?: number; action?: string; userId?: string } = {}) => {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') query.set(k, String(v));
    return request<{ logs: AuditLogEntry[]; total: number }>(`${org(orgId)}/audit?${query}`);
  },
  async exportCsv(orgId: string): Promise<Blob> {
    const response = await request<Response>(`${org(orgId)}/audit/export`, { raw: true });
    return response.blob();
  },
};

// ============================================
// SHARING
// ============================================

export const sharingApi = {
  create: (
    orgId: string,
    secretId: string,
    data: {
      id: string;
      ciphertextBlob: string;
      iv: string;
      expiresInHours: number;
      maxViews: number;
      allowCopy: boolean;
      recipientEmail?: string;
      accessSalt?: string;
      accessVerifier?: string;
    }
  ) => request<ShareLink>(`${org(orgId)}/secrets/${secretId}/shares`, { method: 'POST', json: data }),
  list: (orgId: string, secretId: string) => request<ShareLink[]>(`${org(orgId)}/secrets/${secretId}/shares`),
  revoke: (orgId: string, linkId: string) => request<{ success: boolean }>(`${org(orgId)}/shares/${linkId}`, { method: 'DELETE' }),
  publicInfo: (linkId: string) => request<PublicShareInfo>(`/share/${encodeURIComponent(linkId)}`),
  publicAccess: (linkId: string, accessToken?: string) =>
    request<PublicShareContent>(`/share/${encodeURIComponent(linkId)}/access`, { method: 'POST', json: { accessToken } }),
};

// ============================================
// ORG SETTINGS AND HEALTH
// ============================================

export const orgSettingsApi = {
  get: (orgId: string) => request<OrgSettings>(`${org(orgId)}/settings`),
  update: (orgId: string, data: Partial<OrgSettings>) => request<OrgSettings>(`${org(orgId)}/settings`, { method: 'PUT', json: data }),
  getHealth: (orgId: string) => request<HealthReport>(`${org(orgId)}/health`),
};

// ============================================
// EMERGENCY ACCESS
// ============================================

export const emergencyApi = {
  listContacts: (orgId: string) => request<EmergencyContact[]>(`${org(orgId)}/emergency-contacts`),
  lookupContact: (orgId: string, email: string) =>
    request<{ userId: string; email: string; name: string | null; publicKey: string }>(
      `${org(orgId)}/emergency-contacts/lookup?email=${encodeURIComponent(email)}`
    ),
  addContact: (orgId: string, data: { contactEmail: string; contactName?: string; waitTimeHours: number; encryptedOrgKey: string }) =>
    request<EmergencyContact>(`${org(orgId)}/emergency-contacts`, { method: 'POST', json: data }),
  removeContact: (orgId: string, contactId: string) =>
    request<{ success: boolean }>(`${org(orgId)}/emergency-contacts/${contactId}`, { method: 'DELETE' }),
  listRequests: (orgId: string) => request<EmergencyRequest[]>(`${org(orgId)}/emergency-requests`),
  approveRequest: (orgId: string, requestId: string) =>
    request<{ status: string }>(`${org(orgId)}/emergency-requests/${requestId}/approve`, { method: 'POST' }),
  denyRequest: (orgId: string, requestId: string) =>
    request<{ status: string }>(`${org(orgId)}/emergency-requests/${requestId}/deny`, { method: 'POST' }),
  myAccess: () => request<EmergencyAccessEntry[]>('/emergency/access'),
  requestAccess: (contactId: string, reason: string) =>
    request<{ id: string; grantAt: string }>(`/emergency/access/${contactId}/request`, { method: 'POST', json: { reason } }),
  claimAccess: (requestId: string) =>
    request<{ orgId: string; role: Role }>(`/emergency/access/requests/${requestId}/claim`, { method: 'POST' }),
};
