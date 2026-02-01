/**
 * CloudVault API Client
 * 
 * Handles all communication with the Cloudflare Workers backend.
 * 
 * @module lib/api
 */

/**
 * API base URL
 * - Uses VITE_API_URL if set (for custom API servers)
 * - Falls back to '/api' (works with Cloudflare Pages proxy)
 */
const API_BASE = import.meta.env.VITE_API_URL || '/api';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface User {
  id: string;
  email: string;
  name: string | null;
  publicKey: string | null;
  encryptedPrivateKey: string | null;
  salt: string | null;
  authProvider: 'github' | 'magic_link';
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  role: 'admin' | 'member' | 'read_only';
  encryptedOrgKey: string;
  createdAt: string;
}

export type SecretType = 'password' | 'note' | 'api_key' | 'card' | 'totp';

export interface Secret {
  id: string;
  orgId: string;
  name: string;
  url: string | null;
  usernameHint: string | null;
  ciphertextBlob: string;
  iv: string;
  version: number;
  createdBy: string;
  updatedAt: string;
  categoryId: string | null;
  isFavorite: boolean;
  secretType: SecretType;
  expiresAt: string | null;
  tags: string[];
  categoryName?: string | null;
  categoryColor?: string | null;
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

export interface SecretHistory {
  id: number;
  secretId: string;
  version: number;
  ciphertextBlob: string;
  iv: string;
  changedBy: string;
  changedByEmail: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: number;
  orgId: string;
  userId: string;
  userEmail: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  metadata: string | null;
  ipAddress: string | null;
  timestamp: string;
}

export interface Membership {
  userId: string;
  orgId: string;
  role: 'admin' | 'member' | 'read_only';
  encryptedOrgKey: string | null;
  status: 'pending' | 'active';
  userEmail: string;
  userName: string | null;
  userPublicKey: string | null;
  createdAt: string;
}

// ============================================
// API HELPERS
// ============================================

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('cloudvault_token');
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new ApiError(response.status, error.message || 'Request failed');
  }
  
  return response.json();
}

// ============================================
// AUTH API
// ============================================

export const authApi = {
  /**
   * Get GitHub OAuth URL
   */
  getGithubAuthUrl(): string {
    return `${API_BASE}/auth/github`;
  },

  /**
   * Exchange GitHub code for token
   */
  async githubCallback(code: string): Promise<{ token: string; user: User; isNewUser: boolean }> {
    return fetchApi('/auth/github/callback', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  /**
   * Request magic link
   */
  async requestMagicLink(email: string): Promise<{ message: string }> {
    return fetchApi('/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  /**
   * Verify magic link token
   */
  async verifyMagicLink(token: string): Promise<{ token: string; user: User; isNewUser: boolean }> {
    return fetchApi('/auth/magic-link/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<User> {
    return fetchApi('/auth/me');
  },

  /**
   * Setup user keys (first time login)
   */
  async setupKeys(data: {
    publicKey: string;
    encryptedPrivateKey: string;
    salt: string;
  }): Promise<User> {
    return fetchApi('/auth/setup-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Logout
   */
  logout(): void {
    localStorage.removeItem('cloudvault_token');
  },
};

// ============================================
// ORGANIZATIONS API
// ============================================

export const orgsApi = {
  /**
   * List user's organizations
   */
  async list(): Promise<Organization[]> {
    return fetchApi('/organizations');
  },

  /**
   * Create a new organization
   */
  async create(data: { name: string; encryptedOrgKey: string }): Promise<Organization> {
    return fetchApi('/organizations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Get organization members
   */
  async getMembers(orgId: string): Promise<Membership[]> {
    return fetchApi(`/organizations/${orgId}/members`);
  },

  /**
   * Invite a user to the organization
   */
  async inviteUser(orgId: string, email: string): Promise<Membership> {
    return fetchApi(`/organizations/${orgId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  /**
   * Approve pending user and grant access
   */
  async approveUser(
    orgId: string,
    userId: string,
    encryptedOrgKey: string
  ): Promise<Membership> {
    return fetchApi(`/organizations/${orgId}/members/${userId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ encryptedOrgKey }),
    });
  },

  /**
   * Remove user from organization
   */
  async removeUser(orgId: string, userId: string): Promise<void> {
    return fetchApi(`/organizations/${orgId}/members/${userId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Update user role
   */
  async updateRole(
    orgId: string,
    userId: string,
    role: 'admin' | 'member' | 'read_only'
  ): Promise<Membership> {
    return fetchApi(`/organizations/${orgId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  },
};

// ============================================
// SECRETS API
// ============================================

export const secretsApi = {
  /**
   * List secrets in an organization with optional filters
   */
  async list(
    orgId: string,
    options?: {
      categoryId?: string;
      type?: SecretType;
      favorites?: boolean;
      search?: string;
    }
  ): Promise<Secret[]> {
    const params = new URLSearchParams();
    if (options?.categoryId) params.set('categoryId', options.categoryId);
    if (options?.type) params.set('type', options.type);
    if (options?.favorites) params.set('favorites', 'true');
    if (options?.search) params.set('search', options.search);
    const query = params.toString();
    return fetchApi(`/organizations/${orgId}/secrets${query ? `?${query}` : ''}`);
  },

  /**
   * Get a single secret
   */
  async get(orgId: string, secretId: string): Promise<Secret> {
    return fetchApi(`/organizations/${orgId}/secrets/${secretId}`);
  },

  /**
   * Create a new secret
   */
  async create(
    orgId: string,
    data: {
      name: string;
      url?: string;
      usernameHint?: string;
      ciphertextBlob: string;
      iv: string;
      categoryId?: string | null;
      secretType?: SecretType;
      tags?: string[];
      expiresAt?: string | null;
    }
  ): Promise<Secret> {
    return fetchApi(`/organizations/${orgId}/secrets`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Update a secret
   */
  async update(
    orgId: string,
    secretId: string,
    data: {
      name?: string;
      url?: string;
      usernameHint?: string;
      ciphertextBlob?: string;
      iv?: string;
      categoryId?: string | null;
      secretType?: SecretType;
      tags?: string[];
      expiresAt?: string | null;
      isFavorite?: boolean;
    }
  ): Promise<Secret> {
    return fetchApi(`/organizations/${orgId}/secrets/${secretId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * Toggle favorite status
   */
  async toggleFavorite(orgId: string, secretId: string, isFavorite: boolean): Promise<{ success: boolean; isFavorite: boolean }> {
    return fetchApi(`/organizations/${orgId}/secrets/${secretId}/favorite`, {
      method: 'PATCH',
      body: JSON.stringify({ isFavorite }),
    });
  },

  /**
   * Delete a secret
   */
  async delete(orgId: string, secretId: string): Promise<void> {
    return fetchApi(`/organizations/${orgId}/secrets/${secretId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get secret history
   */
  async getHistory(orgId: string, secretId: string): Promise<SecretHistory[]> {
    return fetchApi(`/organizations/${orgId}/secrets/${secretId}/history`);
  },

  /**
   * Get expiring secrets (within 30 days)
   */
  async getExpiring(orgId: string): Promise<Secret[]> {
    return fetchApi(`/organizations/${orgId}/secrets/expiring`);
  },
};

// ============================================
// CATEGORIES API
// ============================================

export const categoriesApi = {
  /**
   * List categories in an organization
   */
  async list(orgId: string): Promise<Category[]> {
    return fetchApi(`/organizations/${orgId}/categories`);
  },

  /**
   * Create a new category
   */
  async create(
    orgId: string,
    data: { name: string; icon?: string; color?: string }
  ): Promise<Category> {
    return fetchApi(`/organizations/${orgId}/categories`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Update a category
   */
  async update(
    orgId: string,
    categoryId: string,
    data: { name?: string; icon?: string; color?: string; sortOrder?: number }
  ): Promise<Category> {
    return fetchApi(`/organizations/${orgId}/categories/${categoryId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * Delete a category
   */
  async delete(orgId: string, categoryId: string): Promise<void> {
    return fetchApi(`/organizations/${orgId}/categories/${categoryId}`, {
      method: 'DELETE',
    });
  },
};

// ============================================
// PREFERENCES API
// ============================================

export const preferencesApi = {
  /**
   * Get user preferences
   */
  async get(): Promise<UserPreferences> {
    return fetchApi('/preferences');
  },

  /**
   * Update user preferences
   */
  async update(data: Partial<UserPreferences>): Promise<UserPreferences> {
    return fetchApi('/preferences', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};

// ============================================
// AUDIT API
// ============================================

export const auditApi = {
  /**
   * Get audit logs for an organization
   */
  async list(
    orgId: string,
    options?: {
      limit?: number;
      offset?: number;
      action?: string;
      userId?: string;
    }
  ): Promise<{ logs: AuditLogEntry[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    if (options?.action) params.set('action', options.action);
    if (options?.userId) params.set('userId', options.userId);
    
    const query = params.toString();
    return fetchApi(`/organizations/${orgId}/audit${query ? `?${query}` : ''}`);
  },

  /**
   * Export audit logs as CSV
   */
  async exportCsv(orgId: string): Promise<Blob> {
    const token = localStorage.getItem('cloudvault_token');
    const response = await fetch(`${API_BASE}/organizations/${orgId}/audit/export`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    
    if (!response.ok) {
      throw new ApiError(response.status, 'Export failed');
    }
    
    return response.blob();
  },
};

// ============================================
// SHARING API
// ============================================

export interface ShareLink {
  id: string;
  url: string;
  expiresAt: string;
  maxViews: number;
  viewCount: number;
  allowCopy: boolean;
  recipientEmail?: string;
  isRevoked: boolean;
  isExpired: boolean;
  isExhausted: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastViewedAt?: string;
  createdByEmail: string;
}

export const sharingApi = {
  /**
   * Create a share link for a secret
   */
  async create(
    orgId: string,
    secretId: string,
    data: {
      expiresInHours: number;
      maxViews?: number;
      accessPassword?: string;
      allowCopy?: boolean;
      recipientEmail?: string;
    }
  ): Promise<ShareLink> {
    return fetchApi(`/organizations/${orgId}/secrets/${secretId}/share`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * List share links for a secret
   */
  async list(orgId: string, secretId: string): Promise<ShareLink[]> {
    return fetchApi(`/organizations/${orgId}/secrets/${secretId}/shares`);
  },

  /**
   * Revoke a share link
   */
  async revoke(orgId: string, linkId: string): Promise<void> {
    return fetchApi(`/organizations/${orgId}/shares/${linkId}`, {
      method: 'DELETE',
    });
  },
};

// ============================================
// ORGANIZATION SETTINGS API
// ============================================

export interface OrgSettings {
  require2fa: boolean;
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
  metrics: {
    expiringSoon: number;
    expired: number;
    oldPasswords: number;
  };
  expiringSecrets: Array<{
    id: string;
    name: string;
    expiresAt: string;
    secretType: string;
    daysUntilExpiry: number;
  }>;
  oldPasswords: Array<{
    id: string;
    name: string;
    lastUpdated: string;
    daysSinceUpdate: number;
  }>;
}

export const orgSettingsApi = {
  /**
   * Get organization settings
   */
  async get(orgId: string): Promise<OrgSettings> {
    return fetchApi(`/organizations/${orgId}/settings`);
  },

  /**
   * Update organization settings
   */
  async update(orgId: string, data: Partial<OrgSettings>): Promise<OrgSettings> {
    return fetchApi(`/organizations/${orgId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * Get password health report
   */
  async getHealth(orgId: string): Promise<HealthReport> {
    return fetchApi(`/organizations/${orgId}/health`);
  },
};

// ============================================
// EMERGENCY ACCESS API
// ============================================

export interface EmergencyContact {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  contactEmail: string;
  contactName?: string;
  waitTimeHours: number;
  createdAt: string;
}

export interface EmergencyRequest {
  id: string;
  requestedAt: string;
  grantAt: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  reason: string;
  contactEmail: string;
  contactName?: string;
  waitTimeHours: number;
  userEmail: string;
  userName?: string;
  canDeny: boolean;
}

export const emergencyApi = {
  /**
   * List emergency contacts for the organization
   */
  async listContacts(orgId: string): Promise<EmergencyContact[]> {
    return fetchApi(`/organizations/${orgId}/emergency-contacts`);
  },

  /**
   * Add an emergency contact
   */
  async addContact(
    orgId: string,
    data: { contactEmail: string; contactName?: string; waitTimeHours: number }
  ): Promise<EmergencyContact> {
    return fetchApi(`/organizations/${orgId}/emergency-contacts`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Remove an emergency contact
   */
  async removeContact(orgId: string, contactId: string): Promise<void> {
    return fetchApi(`/organizations/${orgId}/emergency-contacts/${contactId}`, {
      method: 'DELETE',
    });
  },

  /**
   * List emergency access requests
   */
  async listRequests(orgId: string): Promise<EmergencyRequest[]> {
    return fetchApi(`/organizations/${orgId}/emergency-requests`);
  },

  /**
   * Deny an emergency access request
   */
  async denyRequest(orgId: string, requestId: string): Promise<void> {
    return fetchApi(`/organizations/${orgId}/emergency-requests/${requestId}/deny`, {
      method: 'POST',
    });
  },
};
