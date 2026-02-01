-- CloudVault D1 Database Schema
-- Run: wrangler d1 execute cloudvault-db --local --file=./src/db/schema.sql

-- ============================================
-- IDENTITY TABLES
-- ============================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    public_key TEXT,
    encrypted_private_key TEXT,
    salt TEXT,
    auth_provider TEXT,  -- 'github' or 'magic_link'
    github_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Organizations (Vaults)
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Memberships with encrypted org keys
CREATE TABLE IF NOT EXISTS memberships (
    user_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',  -- 'admin', 'member', 'read_only'
    encrypted_org_key TEXT,
    status TEXT DEFAULT 'pending',  -- 'pending', 'active'
    invited_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, org_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================
-- CATEGORIES TABLE
-- ============================================

-- Categories for organizing secrets
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT DEFAULT 'folder',        -- Icon identifier
    color TEXT DEFAULT '#6366f1',      -- Hex color for UI
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- ============================================
-- SECRETS TABLES
-- ============================================

-- Secrets (encrypted credentials)
CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT,
    username_hint TEXT,  -- Optional unencrypted hint for searchability
    ciphertext_blob TEXT NOT NULL,
    iv TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    created_by TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- New fields for enhanced functionality
    category_id TEXT,                  -- Optional category reference
    is_favorite INTEGER DEFAULT 0,     -- 1 = favorited
    secret_type TEXT DEFAULT 'password', -- 'password', 'note', 'api_key', 'card'
    expires_at TIMESTAMP,              -- Optional expiration date
    tags TEXT,                         -- JSON array of tags
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- Password history for rollback capability
CREATE TABLE IF NOT EXISTS secret_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    secret_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    ciphertext_blob TEXT NOT NULL,
    iv TEXT NOT NULL,
    changed_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (secret_id) REFERENCES secrets(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES users(id)
);

-- ============================================
-- AUDIT & AUTH TABLES
-- ============================================

-- Audit logs (the killer feature for governance)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT,
    user_id TEXT,
    user_email TEXT,
    action TEXT NOT NULL,
    target_type TEXT,  -- 'secret', 'user', 'org', 'membership'
    target_id TEXT,
    target_name TEXT,  -- Human-readable name for reports
    metadata TEXT,     -- JSON with additional details
    ip_address TEXT,
    user_agent TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Magic link tokens for passwordless auth
CREATE TABLE IF NOT EXISTS magic_links (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Session tokens (for JWT refresh)
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User preferences (theme, settings)
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    theme TEXT DEFAULT 'system',       -- 'light', 'dark', 'system'
    session_timeout INTEGER DEFAULT 15, -- Minutes of inactivity before lock
    clipboard_clear INTEGER DEFAULT 30, -- Seconds before clipboard clear (0 = disabled)
    show_favicons INTEGER DEFAULT 1,    -- Show website favicons
    compact_view INTEGER DEFAULT 0,     -- Compact list view
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- SECURE SHARING LINKS
-- ============================================

-- Temporary share links for external access
CREATE TABLE IF NOT EXISTS share_links (
    id TEXT PRIMARY KEY,
    secret_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    access_password_hash TEXT,         -- Optional password protection (hashed)
    expires_at TIMESTAMP NOT NULL,
    max_views INTEGER DEFAULT 1,       -- Max number of views (0 = unlimited)
    view_count INTEGER DEFAULT 0,
    allow_copy INTEGER DEFAULT 1,      -- Allow copying to clipboard
    recipient_email TEXT,              -- Optional: who it's intended for
    revoked INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_viewed_at TIMESTAMP,
    FOREIGN KEY (secret_id) REFERENCES secrets(id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ============================================
-- EMERGENCY ACCESS
-- ============================================

-- Emergency access contacts
CREATE TABLE IF NOT EXISTS emergency_contacts (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,             -- The user granting access
    contact_email TEXT NOT NULL,
    contact_name TEXT,
    wait_time_hours INTEGER DEFAULT 48, -- Hours to wait before granting access
    status TEXT DEFAULT 'active',       -- 'active', 'revoked'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Emergency access requests
CREATE TABLE IF NOT EXISTS emergency_requests (
    id TEXT PRIMARY KEY,
    emergency_contact_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    grant_at TIMESTAMP,                 -- When access will be granted (requested_at + wait_time)
    status TEXT DEFAULT 'pending',      -- 'pending', 'approved', 'denied', 'expired'
    denied_by TEXT,
    denied_at TIMESTAMP,
    reason TEXT,
    FOREIGN KEY (emergency_contact_id) REFERENCES emergency_contacts(id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (denied_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================
-- ORGANIZATION SETTINGS
-- ============================================

-- Organization-wide settings
CREATE TABLE IF NOT EXISTS organization_settings (
    org_id TEXT PRIMARY KEY,
    require_2fa INTEGER DEFAULT 0,          -- Require 2FA for all members
    min_password_length INTEGER DEFAULT 12, -- Minimum for generated passwords
    password_expiry_days INTEGER DEFAULT 90, -- Default expiry for new passwords (0 = none)
    allow_share_links INTEGER DEFAULT 1,    -- Allow creating share links
    share_link_max_hours INTEGER DEFAULT 168, -- Max share link duration (1 week)
    allow_emergency_access INTEGER DEFAULT 1,
    emergency_wait_min_hours INTEGER DEFAULT 24, -- Minimum wait time for emergency access
    audit_retention_days INTEGER DEFAULT 365,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- ============================================
-- CUSTOM FIELDS
-- ============================================

-- Custom field definitions per organization
CREATE TABLE IF NOT EXISTS custom_field_definitions (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    field_type TEXT DEFAULT 'text',     -- 'text', 'password', 'url', 'email', 'number', 'date', 'boolean'
    is_encrypted INTEGER DEFAULT 1,     -- Should value be encrypted?
    is_required INTEGER DEFAULT 0,
    applies_to TEXT DEFAULT 'all',      -- 'all', 'password', 'note', 'api_key', 'card'
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Custom field values for secrets
CREATE TABLE IF NOT EXISTS custom_field_values (
    id TEXT PRIMARY KEY,
    secret_id TEXT NOT NULL,
    field_definition_id TEXT NOT NULL,
    value_encrypted TEXT,               -- Encrypted value (if is_encrypted = 1)
    value_plain TEXT,                   -- Plain value (if is_encrypted = 0)
    iv TEXT,                            -- IV for encrypted values
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (secret_id) REFERENCES secrets(id) ON DELETE CASCADE,
    FOREIGN KEY (field_definition_id) REFERENCES custom_field_definitions(id) ON DELETE CASCADE
);

-- ============================================
-- TOTP 2FA CODES
-- ============================================

-- Add TOTP secret storage to secrets table (handled via secret_type = 'totp')
-- TOTP secrets store: { secret: base32, issuer: string, algorithm: string, digits: number, period: number }

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);

-- Membership indexes (composite for common query patterns)
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org_id ON memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user_org_status ON memberships(user_id, org_id, status);

-- Secret indexes
CREATE INDEX IF NOT EXISTS idx_secrets_org_id ON secrets(org_id);
CREATE INDEX IF NOT EXISTS idx_secrets_category_id ON secrets(category_id);
CREATE INDEX IF NOT EXISTS idx_secrets_is_favorite ON secrets(org_id, is_favorite);
CREATE INDEX IF NOT EXISTS idx_secrets_secret_type ON secrets(org_id, secret_type);
CREATE INDEX IF NOT EXISTS idx_secrets_expires_at ON secrets(expires_at);
CREATE INDEX IF NOT EXISTS idx_secrets_updated_at ON secrets(org_id, updated_at);

-- Category indexes
CREATE INDEX IF NOT EXISTS idx_categories_org_id ON categories(org_id);

-- History indexes
CREATE INDEX IF NOT EXISTS idx_secret_history_secret_id ON secret_history(secret_id);

-- Audit log indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON audit_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- Auth indexes
CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);
CREATE INDEX IF NOT EXISTS idx_magic_links_token_used ON magic_links(token, used);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- Share link indexes
CREATE INDEX IF NOT EXISTS idx_share_links_secret_id ON share_links(secret_id);
CREATE INDEX IF NOT EXISTS idx_share_links_org_id ON share_links(org_id);
CREATE INDEX IF NOT EXISTS idx_share_links_expires_at ON share_links(expires_at);

-- Emergency access indexes
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_org_id ON emergency_contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user_id ON emergency_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_emergency_requests_org_id ON emergency_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_emergency_requests_status ON emergency_requests(status);
CREATE INDEX IF NOT EXISTS idx_emergency_requests_contact_status ON emergency_requests(emergency_contact_id, status);

-- Custom fields indexes
CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_org_id ON custom_field_definitions(org_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_secret_id ON custom_field_values(secret_id);
