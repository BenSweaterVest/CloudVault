-- CloudVault 0.3.0 schema changes
--
-- Apply with: npm run db:migrate (local) / npm run db:migrate:prod (remote)
--
-- Summary:
--   * KV is no longer used. Sessions, token revocation and rate limits live in D1.
--   * Secrets carry an encryption format version (enc_version) so ciphertext can be
--     bound to its record with AES-GCM additional authenticated data.
--   * Favorites are per user instead of shared across the organization.
--   * Share links store their own ciphertext, encrypted client side with a key that
--     only exists in the link fragment. Old links could never be decrypted by the
--     recipient, so they are revoked here.
--   * Emergency access stores an org key encrypted for the contact's public key.
--     Old contacts had no key and could never be used, so they are revoked here.
--   * Custom field tables are dropped: custom fields now live inside the encrypted
--     secret payload, which keeps them zero-knowledge.

-- --------------------------------------------
-- Users: per-user KDF iteration count
-- --------------------------------------------
-- Existing users were created with 100,000 PBKDF2 iterations. New users and anyone
-- who changes their master password get the current client default.
ALTER TABLE users ADD COLUMN kdf_iterations INTEGER NOT NULL DEFAULT 100000;

-- --------------------------------------------
-- Organizations: key version (incremented on key rotation)
-- --------------------------------------------
ALTER TABLE organizations ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;

-- --------------------------------------------
-- Secrets: encryption format version
-- --------------------------------------------
-- 1 = AES-256-GCM without associated data (legacy)
-- 2 = AES-256-GCM with associated data bound to org id and secret id
ALTER TABLE secrets ADD COLUMN enc_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE secret_history ADD COLUMN enc_version INTEGER NOT NULL DEFAULT 1;

-- --------------------------------------------
-- Per-user favorites
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS secret_favorites (
    user_id TEXT NOT NULL,
    secret_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, secret_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (secret_id) REFERENCES secrets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_secret_favorites_secret_id ON secret_favorites(secret_id);

-- Carry existing (org-wide) favorites over to every active member of the org.
INSERT OR IGNORE INTO secret_favorites (user_id, secret_id)
SELECT m.user_id, s.id
FROM secrets s
JOIN memberships m ON m.org_id = s.org_id AND m.status = 'active'
WHERE s.is_favorite = 1;

DROP INDEX IF EXISTS idx_secrets_is_favorite;
ALTER TABLE secrets DROP COLUMN is_favorite;

-- --------------------------------------------
-- Sessions (replaces the KV token blacklist and activity tracking)
-- --------------------------------------------
-- Times are unix epoch seconds.
DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,                 -- JWT "jti"
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    timeout_minutes INTEGER NOT NULL DEFAULT 15,  -- 0 = never
    revoked INTEGER NOT NULL DEFAULT 0,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- --------------------------------------------
-- Rate limiting (replaces KV counters; atomic upserts)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,                -- prefix:client:window_start
    count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL          -- epoch seconds
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at ON rate_limits(expires_at);

-- --------------------------------------------
-- Magic links: the token column now stores a SHA-256 hash of the token.
-- Outstanding plaintext tokens are invalidated.
-- --------------------------------------------
DELETE FROM magic_links;

-- --------------------------------------------
-- Share links: client-side encrypted payload + client-derived access verifier
-- --------------------------------------------
ALTER TABLE share_links ADD COLUMN ciphertext_blob TEXT;
ALTER TABLE share_links ADD COLUMN iv TEXT;
ALTER TABLE share_links ADD COLUMN access_salt TEXT;
ALTER TABLE share_links ADD COLUMN access_verifier TEXT;
UPDATE share_links SET revoked = 1;

-- --------------------------------------------
-- Emergency access: escrowed org key for an existing CloudVault user
-- --------------------------------------------
ALTER TABLE emergency_contacts ADD COLUMN contact_user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE emergency_contacts ADD COLUMN encrypted_org_key TEXT;
ALTER TABLE emergency_contacts ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;
UPDATE emergency_contacts SET status = 'revoked';
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_contact_user_id ON emergency_contacts(contact_user_id);

ALTER TABLE emergency_requests ADD COLUMN requested_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE emergency_requests ADD COLUMN resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE emergency_requests ADD COLUMN resolved_at TIMESTAMP;
UPDATE emergency_requests SET status = 'expired' WHERE status = 'pending';

-- --------------------------------------------
-- Custom fields now live in the encrypted payload
-- --------------------------------------------
DROP TABLE IF EXISTS custom_field_values;
DROP TABLE IF EXISTS custom_field_definitions;
