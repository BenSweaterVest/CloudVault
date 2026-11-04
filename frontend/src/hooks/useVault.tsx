/**
 * Vault state: the unlocked private key, decrypted org keys, the selected
 * organization and its secret list, plus encrypted CRUD helpers.
 *
 * Keys live only in memory. Locking (manually, on idle, or on sign-out)
 * drops them.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import {
  orgsApi,
  secretsApi,
  type Organization,
  type Secret,
  type SecretInput,
  type SecretMeta,
} from '../lib/api';
import {
  createOrganizationKeys,
  decryptOrgKey,
  decryptSecretPayload,
  encryptSecretPayload,
  unwrapPrivateKey,
  type SecretPayload,
} from '../lib/crypto';

const LAST_ORG_KEY = 'cloudvault_last_org';

export interface OpenedSecret {
  secret: Secret;
  payload: SecretPayload;
}

interface VaultContextType {
  isUnlocked: boolean;
  isLoading: boolean;
  error: string | null;
  organizations: Organization[];
  pendingInvites: Array<{ id: string; name: string }>;
  currentOrg: Organization | null;
  secrets: SecretMeta[];

  unlock: (masterPassword: string) => Promise<void>;
  lock: () => void;
  loadOrganizations: () => Promise<Organization[]>;
  selectOrg: (orgId: string) => Promise<void>;
  refreshSecrets: () => Promise<void>;
  createOrganization: (name: string) => Promise<Organization>;

  /** Fetch (audited) and decrypt one secret. */
  openSecret: (secretId: string) => Promise<OpenedSecret>;
  /** Decrypt any record of the current org (e.g. history entries). */
  decryptRecord: (secretId: string, record: { ciphertextBlob: string; iv: string; encVersion?: number }) => Promise<SecretPayload>;
  createSecret: (input: SecretInput, payload: SecretPayload) => Promise<Secret>;
  /** Pass `payload` to change the encrypted content; omit to change metadata only. */
  updateSecret: (secretId: string, input: Partial<SecretInput>, payload?: SecretPayload, expectedVersion?: number) => Promise<Secret>;
  deleteSecret: (secretId: string) => Promise<void>;
  toggleFavorite: (secretId: string) => Promise<void>;
  /** Encrypt many payloads for import (current format, client ids). */
  encryptForImport: (items: Array<SecretInput & { payload: SecretPayload }>) => Promise<Array<SecretInput & { id: string; ciphertextBlob: string; iv: string; encVersion: 1 | 2 }>>;

  getOrgKey: () => CryptoKey | null;
  getPrivateKey: () => CryptoKey | null;
  /** Forget a cached org key (after rotation) and reload orgs. */
  reloadOrgKeys: () => Promise<void>;
}

const VaultContext = createContext<VaultContextType | null>(null);

export function useVault(): VaultContextType {
  const context = useContext(VaultContext);
  if (!context) throw new Error('useVault must be used within a VaultProvider');
  return context;
}

function rememberOrg(orgId: string | null) {
  try {
    if (orgId) localStorage.setItem(LAST_ORG_KEY, orgId);
    else localStorage.removeItem(LAST_ORG_KEY);
  } catch {
    // ignore
  }
}

function lastOrg(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}

export function VaultProvider({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useAuth();

  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const orgKeys = useRef(new Map<string, CryptoKey>());
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [pendingInvites, setPendingInvites] = useState<Array<{ id: string; name: string }>>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lock = useCallback(() => {
    setPrivateKey(null);
    orgKeys.current = new Map();
    setSecrets([]);
    setCurrentOrg(null);
    setOrganizations([]);
    setPendingInvites([]);
  }, []);

  // Signing out (or switching user) always locks.
  useEffect(() => {
    lock();
  }, [user?.id, lock]);

  const requireOrgKey = useCallback(
    (org: Organization | null = currentOrg): { org: Organization; key: CryptoKey } => {
      if (!org) throw new Error('No organization selected');
      const key = orgKeys.current.get(org.id);
      if (!key) throw new Error('Vault is locked');
      return { org, key };
    },
    [currentOrg]
  );

  const unlock = useCallback(
    async (masterPassword: string) => {
      if (!user?.encryptedPrivateKey || !user.salt) throw new Error('Your master password has not been set up yet');
      setIsLoading(true);
      setError(null);
      try {
        const key = await unwrapPrivateKey(user.encryptedPrivateKey, user.salt, masterPassword, user.kdfIterations);
        setPrivateKey(key);
      } catch {
        setError('Incorrect master password');
        throw new Error('Incorrect master password');
      } finally {
        setIsLoading(false);
      }
    },
    [user]
  );

  const fetchSecrets = useCallback(async (orgId: string) => {
    const list = await secretsApi.list(orgId);
    setSecrets(list);
  }, []);

  const activateOrg = useCallback(
    async (org: Organization, key: CryptoKey | null = privateKey) => {
      if (!key) throw new Error('Vault is locked');
      if (!orgKeys.current.has(org.id)) {
        orgKeys.current.set(org.id, await decryptOrgKey(org.encryptedOrgKey, key));
      }
      setCurrentOrg(org);
      rememberOrg(org.id);
      await fetchSecrets(org.id);
    },
    [privateKey, fetchSecrets]
  );

  const loadOrganizations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { organizations: orgs, pendingInvites: pending } = await orgsApi.list();
      setOrganizations(orgs);
      setPendingInvites(pending);

      if (privateKey && orgs.length > 0) {
        const keep = currentOrg && orgs.find((o) => o.id === currentOrg.id);
        const preferred = keep || orgs.find((o) => o.id === lastOrg()) || orgs[0];
        await activateOrg(preferred);
      } else if (orgs.length === 0) {
        setCurrentOrg(null);
        setSecrets([]);
      }
      return orgs;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [privateKey, currentOrg, activateOrg]);

  // Load organizations as soon as the vault is unlocked.
  useEffect(() => {
    if (privateKey) void loadOrganizations().catch(() => undefined);
    // Only on unlock; loadOrganizations identity changes with currentOrg.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privateKey]);

  const selectOrg = useCallback(
    async (orgId: string) => {
      const org = organizations.find((o) => o.id === orgId);
      if (!org) throw new Error('Organization not found');
      setIsLoading(true);
      setError(null);
      try {
        await activateOrg(org);
      } catch (err) {
        setError('Could not open this organization');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [organizations, activateOrg]
  );

  const refreshSecrets = useCallback(async () => {
    if (currentOrg) await fetchSecrets(currentOrg.id);
  }, [currentOrg, fetchSecrets]);

  const createOrganization = useCallback(
    async (name: string) => {
      if (!user?.publicKey) throw new Error('Set up your master password first');
      const { orgKey, encryptedOrgKey } = await createOrganizationKeys(user.publicKey);
      const org = await orgsApi.create({ name, encryptedOrgKey });
      orgKeys.current.set(org.id, orgKey);
      setOrganizations((prev) => [...prev, org].sort((a, b) => a.name.localeCompare(b.name)));
      setCurrentOrg(org);
      rememberOrg(org.id);
      setSecrets([]);
      return org;
    },
    [user]
  );

  const openSecret = useCallback(
    async (secretId: string) => {
      const { org, key } = requireOrgKey();
      const secret = await secretsApi.get(org.id, secretId);
      const payload = await decryptSecretPayload(secret, key, org.id, secret.id);
      return { secret, payload };
    },
    [requireOrgKey]
  );

  const decryptRecord = useCallback<VaultContextType['decryptRecord']>(
    async (secretId, record) => {
      const { org, key } = requireOrgKey();
      return decryptSecretPayload(record, key, org.id, secretId);
    },
    [requireOrgKey]
  );

  const toMeta = (s: Secret): SecretMeta => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { ciphertextBlob, iv, encVersion, ...meta } = s;
    return meta;
  };

  const createSecret = useCallback(
    async (input: SecretInput, payload: SecretPayload) => {
      const { org, key } = requireOrgKey();
      const id = crypto.randomUUID();
      const encrypted = await encryptSecretPayload(payload, key, org.id, id);
      const created = await secretsApi.create(org.id, { ...input, ...encrypted, id });
      setSecrets((prev) => [...prev, toMeta(created)].sort((a, b) => a.name.localeCompare(b.name)));
      return created;
    },
    [requireOrgKey]
  );

  const updateSecret = useCallback<VaultContextType['updateSecret']>(
    async (secretId, input, payload, expectedVersion) => {
      const { org, key } = requireOrgKey();
      const encrypted = payload ? await encryptSecretPayload(payload, key, org.id, secretId) : {};
      const updated = await secretsApi.update(org.id, secretId, { ...input, ...encrypted, expectedVersion });
      setSecrets((prev) => prev.map((s) => (s.id === secretId ? toMeta(updated) : s)));
      return updated;
    },
    [requireOrgKey]
  );

  const deleteSecret = useCallback(
    async (secretId: string) => {
      const { org } = requireOrgKey();
      await secretsApi.delete(org.id, secretId);
      setSecrets((prev) => prev.filter((s) => s.id !== secretId));
    },
    [requireOrgKey]
  );

  const toggleFavorite = useCallback(
    async (secretId: string) => {
      const { org } = requireOrgKey();
      const current = secrets.find((s) => s.id === secretId);
      const next = !current?.isFavorite;
      await secretsApi.toggleFavorite(org.id, secretId, next);
      setSecrets((prev) => prev.map((s) => (s.id === secretId ? { ...s, isFavorite: next } : s)));
    },
    [requireOrgKey, secrets]
  );

  const encryptForImport = useCallback<VaultContextType['encryptForImport']>(
    async (items) => {
      const { org, key } = requireOrgKey();
      return Promise.all(
        items.map(async ({ payload, ...input }) => {
          const id = crypto.randomUUID();
          return { ...input, id, ...(await encryptSecretPayload(payload, key, org.id, id)) };
        })
      );
    },
    [requireOrgKey]
  );

  const getOrgKey = useCallback(() => (currentOrg ? orgKeys.current.get(currentOrg.id) ?? null : null), [currentOrg]);
  const getPrivateKey = useCallback(() => privateKey, [privateKey]);

  const reloadOrgKeys = useCallback(async () => {
    orgKeys.current = new Map();
    await loadOrganizations();
  }, [loadOrganizations]);

  const value = useMemo<VaultContextType>(
    () => ({
      isUnlocked: privateKey !== null,
      isLoading,
      error,
      organizations,
      pendingInvites,
      currentOrg,
      secrets,
      unlock,
      lock,
      loadOrganizations,
      selectOrg,
      refreshSecrets,
      createOrganization,
      openSecret,
      decryptRecord,
      createSecret,
      updateSecret,
      deleteSecret,
      toggleFavorite,
      encryptForImport,
      getOrgKey,
      getPrivateKey,
      reloadOrgKeys,
    }),
    [
      privateKey,
      isLoading,
      error,
      organizations,
      pendingInvites,
      currentOrg,
      secrets,
      unlock,
      lock,
      loadOrganizations,
      selectOrg,
      refreshSecrets,
      createOrganization,
      openSecret,
      decryptRecord,
      createSecret,
      updateSecret,
      deleteSecret,
      toggleFavorite,
      encryptForImport,
      getOrgKey,
      getPrivateKey,
      reloadOrgKeys,
    ]
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
