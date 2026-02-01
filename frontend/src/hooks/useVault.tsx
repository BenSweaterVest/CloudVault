/**
 * CloudVault Vault Hook
 * 
 * Manages vault state including decrypted keys and secrets.
 * Implements zero-knowledge architecture - keys are stored in memory only,
 * never in localStorage or sent to the server in plaintext.
 * 
 * @module hooks/useVault
 * 
 * Security Notes:
 * - Private key is derived from master password and stored in memory
 * - Organization keys are decrypted client-side and stored in memory
 * - All encryption/decryption happens in the browser
 * - Locking the vault clears all keys from memory
 * 
 * @example
 * ```tsx
 * const { isUnlocked, unlock, secrets, decryptSecretData } = useVault();
 * 
 * // Unlock vault with master password
 * await unlock('my-master-password');
 * 
 * // Decrypt a secret's data
 * const decrypted = await decryptSecretData(secrets[0]);
 * console.log(decrypted.password);
 * ```
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { orgsApi, secretsApi, type Organization, type Secret } from '../lib/api';
import {
  unlockPrivateKey,
  decryptOrgKey,
  encryptSecret,
  decryptSecret,
  type SecretData,
} from '../lib/crypto';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Decrypted secret data with metadata
 * 
 * Extends SecretData with additional fields from the Secret model.
 */
interface DecryptedSecret extends SecretData {
  /** Unique secret identifier */
  id: string;
  /** Display name */
  name: string;
  /** Associated URL (nullable) */
  url: string | null;
  /** Unencrypted username hint for search */
  usernameHint: string | null;
  /** Version number for history tracking */
  version: number;
  /** Last modification timestamp */
  updatedAt: string;
}

/**
 * Vault context type definition
 * 
 * Provides all state and methods needed for vault operations.
 */
interface VaultContextType {
  // ---- State ----
  /** Whether the vault is unlocked (private key in memory) */
  isUnlocked: boolean;
  /** Currently selected organization */
  currentOrg: Organization | null;
  /** All organizations user has access to */
  organizations: Organization[];
  /** Secrets in current organization (encrypted) */
  secrets: Secret[];
  /** Loading state for async operations */
  isLoading: boolean;
  /** Error message from last failed operation */
  error: string | null;
  
  // ---- Actions ----
  /** Unlock vault with master password */
  unlock: (masterPassword: string) => Promise<void>;
  /** Lock vault (clear all keys from memory) */
  lock: () => void;
  /** Select an organization and load its secrets */
  selectOrg: (orgId: string) => Promise<void>;
  /** Reload organizations list */
  loadOrganizations: () => Promise<void>;
  /** Reload secrets for current organization */
  loadSecrets: () => Promise<void>;
  
  // ---- Secret Operations ----
  /** Decrypt a secret's encrypted data */
  decryptSecretData: (secret: Secret) => Promise<DecryptedSecret>;
  /** Create and encrypt a new secret */
  createSecret: (data: { name: string; url?: string; usernameHint?: string } & SecretData) => Promise<Secret>;
  /** Update and re-encrypt a secret */
  updateSecret: (secretId: string, data: { name?: string; url?: string; usernameHint?: string } & Partial<SecretData>) => Promise<Secret>;
  /** Delete a secret */
  deleteSecret: (secretId: string) => Promise<void>;
  
  // ---- Key Access ----
  /** Get current org key (for admin operations like adding users) */
  getOrgKey: () => CryptoKey | null;
}

// ============================================
// CONTEXT
// ============================================

const VaultContext = createContext<VaultContextType | null>(null);

/**
 * Hook to access vault context
 * 
 * Provides access to vault state and operations including:
 * - Lock/unlock vault
 * - Organization management
 * - Secret CRUD operations with encryption
 * 
 * @returns {VaultContextType} Vault state and methods
 * @throws {Error} If used outside of VaultProvider
 * 
 * @example
 * ```tsx
 * function SecretsList() {
 *   const { secrets, decryptSecretData, isLoading } = useVault();
 *   
 *   const handleView = async (secret: Secret) => {
 *     const decrypted = await decryptSecretData(secret);
 *     console.log('Password:', decrypted.password);
 *   };
 *   
 *   if (isLoading) return <Spinner />;
 *   return <ul>{secrets.map(s => ...)}</ul>;
 * }
 * ```
 */
export function useVault(): VaultContextType {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error('useVault must be used within a VaultProvider');
  }
  return context;
}

// ============================================
// PROVIDER
// ============================================

/**
 * Props for VaultProvider component
 */
interface VaultProviderProps {
  /** Child components that will have access to vault context */
  children: ReactNode;
}

/**
 * Vault Provider Component
 * 
 * Wraps the application to provide vault state and cryptographic operations.
 * Manages the lifecycle of encryption keys in memory.
 * 
 * Security: All cryptographic keys are stored in React state (memory only).
 * When the vault is locked or the page is refreshed, keys are cleared.
 * 
 * @param {VaultProviderProps} props - Provider props
 * @returns {JSX.Element} Provider component wrapping children
 * 
 * @example
 * ```tsx
 * // In main App component, nest inside AuthProvider
 * function App() {
 *   return (
 *     <AuthProvider>
 *       <VaultProvider>
 *         <Router>
 *           <Routes />
 *         </Router>
 *       </VaultProvider>
 *     </AuthProvider>
 *   );
 * }
 * ```
 */
export function VaultProvider({ children }: VaultProviderProps): JSX.Element {
  const { user } = useAuth();
  
  // Crypto keys (IN MEMORY ONLY - critical for security)
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [orgKeys, setOrgKeys] = useState<Map<string, CryptoKey>>(new Map());
  
  // Data state
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUnlocked = privateKey !== null;

  /**
   * Unlock the vault with master password
   */
  const unlock = useCallback(async (masterPassword: string) => {
    if (!user?.encryptedPrivateKey || !user?.salt) {
      throw new Error('User keys not set up');
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const key = await unlockPrivateKey(
        user.encryptedPrivateKey,
        user.salt,
        masterPassword
      );
      setPrivateKey(key);
    } catch (err) {
      setError('Invalid master password');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  /**
   * Lock the vault (clear all keys from memory)
   */
  const lock = useCallback(() => {
    setPrivateKey(null);
    setOrgKeys(new Map());
    setSecrets([]);
    setCurrentOrg(null);
  }, []);

  /**
   * Load user's organizations
   */
  const loadOrganizations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const orgs = await orgsApi.list();
      setOrganizations(orgs);
      
      // Auto-select first org if only one
      if (orgs.length === 1 && !currentOrg) {
        setCurrentOrg(orgs[0]);
      }
    } catch (err) {
      setError('Failed to load organizations');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentOrg]);

  /**
   * Select an organization and decrypt its key
   */
  const selectOrg = useCallback(async (orgId: string) => {
    if (!privateKey) {
      throw new Error('Vault is locked');
    }
    
    const org = organizations.find(o => o.id === orgId);
    if (!org) {
      throw new Error('Organization not found');
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Check if we already have the org key
      if (!orgKeys.has(orgId)) {
        // Decrypt org key with user's private key
        const orgKey = await decryptOrgKey(org.encryptedOrgKey, privateKey);
        setOrgKeys(prev => new Map(prev).set(orgId, orgKey));
      }
      
      setCurrentOrg(org);
      
      // Load secrets for the org
      const secretsList = await secretsApi.list(orgId);
      setSecrets(secretsList);
    } catch (err) {
      setError('Failed to load organization');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [privateKey, organizations, orgKeys]);

  /**
   * Load secrets for current organization
   */
  const loadSecrets = useCallback(async () => {
    if (!currentOrg) {
      throw new Error('No organization selected');
    }
    
    setIsLoading(true);
    
    try {
      const secretsList = await secretsApi.list(currentOrg.id);
      setSecrets(secretsList);
    } catch (err) {
      setError('Failed to load secrets');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentOrg]);

  /**
   * Decrypt a secret's data
   */
  const decryptSecretData = useCallback(async (secret: Secret): Promise<DecryptedSecret> => {
    if (!currentOrg) {
      throw new Error('No organization selected');
    }
    
    const orgKey = orgKeys.get(currentOrg.id);
    if (!orgKey) {
      throw new Error('Organization key not loaded');
    }
    
    const data = await decryptSecret(
      { ciphertext: secret.ciphertextBlob, iv: secret.iv },
      orgKey
    );
    
    return {
      ...data,
      id: secret.id,
      name: secret.name,
      url: secret.url,
      usernameHint: secret.usernameHint,
      version: secret.version,
      updatedAt: secret.updatedAt,
    };
  }, [currentOrg, orgKeys]);

  /**
   * Create a new secret
   */
  const createSecret = useCallback(async (
    data: { name: string; url?: string; usernameHint?: string } & SecretData
  ): Promise<Secret> => {
    if (!currentOrg) {
      throw new Error('No organization selected');
    }
    
    const orgKey = orgKeys.get(currentOrg.id);
    if (!orgKey) {
      throw new Error('Organization key not loaded');
    }
    
    // Encrypt the secret data
    const { ciphertext, iv } = await encryptSecret(
      { username: data.username, password: data.password, notes: data.notes },
      orgKey
    );
    
    // Create on server
    const secret = await secretsApi.create(currentOrg.id, {
      name: data.name,
      url: data.url,
      usernameHint: data.usernameHint,
      ciphertextBlob: ciphertext,
      iv,
    });
    
    // Update local state
    setSecrets(prev => [...prev, secret]);
    
    return secret;
  }, [currentOrg, orgKeys]);

  /**
   * Update an existing secret
   */
  const updateSecret = useCallback(async (
    secretId: string,
    data: { name?: string; url?: string; usernameHint?: string } & Partial<SecretData>
  ): Promise<Secret> => {
    if (!currentOrg) {
      throw new Error('No organization selected');
    }
    
    const orgKey = orgKeys.get(currentOrg.id);
    if (!orgKey) {
      throw new Error('Organization key not loaded');
    }
    
    const updateData: Parameters<typeof secretsApi.update>[2] = {
      name: data.name,
      url: data.url,
      usernameHint: data.usernameHint,
    };
    
    // If secret data is being updated, re-encrypt
    if (data.username !== undefined || data.password !== undefined) {
      // Get current secret to merge data
      const currentSecret = secrets.find(s => s.id === secretId);
      if (!currentSecret) {
        throw new Error('Secret not found');
      }
      
      // Decrypt current data
      const currentData = await decryptSecret(
        { ciphertext: currentSecret.ciphertextBlob, iv: currentSecret.iv },
        orgKey
      );
      
      // Merge with new data
      const mergedData: SecretData = {
        username: data.username ?? currentData.username,
        password: data.password ?? currentData.password,
        notes: data.notes ?? currentData.notes,
      };
      
      // Re-encrypt
      const { ciphertext, iv } = await encryptSecret(mergedData, orgKey);
      updateData.ciphertextBlob = ciphertext;
      updateData.iv = iv;
    }
    
    // Update on server
    const secret = await secretsApi.update(currentOrg.id, secretId, updateData);
    
    // Update local state
    setSecrets(prev => prev.map(s => s.id === secretId ? secret : s));
    
    return secret;
  }, [currentOrg, orgKeys, secrets]);

  /**
   * Delete a secret
   */
  const deleteSecret = useCallback(async (secretId: string): Promise<void> => {
    if (!currentOrg) {
      throw new Error('No organization selected');
    }
    
    await secretsApi.delete(currentOrg.id, secretId);
    setSecrets(prev => prev.filter(s => s.id !== secretId));
  }, [currentOrg]);

  /**
   * Get current org key (for admin operations like adding users)
   */
  const getOrgKey = useCallback((): CryptoKey | null => {
    if (!currentOrg) return null;
    return orgKeys.get(currentOrg.id) || null;
  }, [currentOrg, orgKeys]);

  const value: VaultContextType = {
    isUnlocked,
    currentOrg,
    organizations,
    secrets,
    isLoading,
    error,
    unlock,
    lock,
    selectOrg,
    loadOrganizations,
    loadSecrets,
    decryptSecretData,
    createSecret,
    updateSecret,
    deleteSecret,
    getOrgKey,
  };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
