/**
 * Secret List Component
 * 
 * Displays the list of secrets/passwords in the vault.
 * Includes search, filtering, and sorting functionality.
 * 
 * @module components/vault/SecretList
 */

import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useVault } from '../../hooks/useVault';
import { orgsApi, type SecretType } from '../../lib/api';
import { createOrganizationKeys, importPublicKey } from '../../lib/crypto';
import SecretView from './SecretView';
import CategoryManager from './CategoryManager';

/** Sort options for secrets */
type SortOption = 'name' | 'updated' | 'created' | 'type';
type SortDirection = 'asc' | 'desc';

export default function SecretList() {
  const { user } = useAuth();
  const {
    isUnlocked,
    currentOrg,
    organizations,
    secrets,
    isLoading,
    // error,  // TODO: Display error state in UI
    unlock,
    loadOrganizations,
    selectOrg,
  } = useVault();
  const navigate = useNavigate();
  
  const [masterPassword, setMasterPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [selectedSecretId, setSelectedSecretId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  
  // Filter state
  const [filterType, setFilterType] = useState<SecretType | 'all'>('all');
  const [filterFavorites, setFilterFavorites] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  
  // Sort state
  const [sortBy, setSortBy] = useState<SortOption>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // Check if user needs to set up keys
  useEffect(() => {
    if (user && !user.publicKey) {
      navigate('/setup');
    }
  }, [user, navigate]);

  // Load organizations when unlocked
  useEffect(() => {
    if (isUnlocked && organizations.length === 0) {
      loadOrganizations();
    }
  }, [isUnlocked, organizations.length, loadOrganizations]);

  // Auto-select first org
  useEffect(() => {
    if (isUnlocked && organizations.length > 0 && !currentOrg) {
      selectOrg(organizations[0].id);
    }
  }, [isUnlocked, organizations, currentOrg, selectOrg]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError(null);
    setIsUnlocking(true);
    
    try {
      await unlock(masterPassword);
      setMasterPassword('');
    } catch (err) {
      setUnlockError('Invalid master password');
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim() || !user?.publicKey) return;
    
    setIsCreatingOrg(true);
    
    try {
      // Import user's public key
      const publicKey = await importPublicKey(user.publicKey);
      
      // Generate org key and encrypt for creator
      const { encryptedOrgKey } = await createOrganizationKeys(publicKey);
      
      // Create org on server
      await orgsApi.create({
        name: newOrgName.trim(),
        encryptedOrgKey,
      });
      
      // Refresh orgs
      await loadOrganizations();
      
      setNewOrgName('');
      setShowCreateOrg(false);
    } catch (err) {
      console.error('Failed to create org:', err);
    } finally {
      setIsCreatingOrg(false);
    }
  };

  // Filter and sort secrets
  const filteredSecrets = useMemo(() => {
    const result = secrets.filter((secret) => {
      // Text search
      const matchesSearch = 
        secret.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        secret.url?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        secret.usernameHint?.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Type filter
      const matchesType = filterType === 'all' || secret.secretType === filterType;
      
      // Favorites filter
      const matchesFavorites = !filterFavorites || secret.isFavorite;
      
      return matchesSearch && matchesType && matchesFavorites;
    });
    
    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'updated':
          comparison = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          break;
        case 'created':
          comparison = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          break;
        case 'type':
          comparison = a.secretType.localeCompare(b.secretType);
          break;
      }
      return sortDir === 'asc' ? comparison : -comparison;
    });
    
    return result;
  }, [secrets, searchQuery, filterType, filterFavorites, sortBy, sortDir]);
  
  // Count active filters
  const activeFilterCount = (filterType !== 'all' ? 1 : 0) + (filterFavorites ? 1 : 0);

  // Show unlock screen if not unlocked
  if (!isUnlocked) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-6">
            <svg
              className="mx-auto h-12 w-12 text-vault-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              <circle cx="12" cy="16" r="1" />
            </svg>
            <h2 className="mt-4 text-xl font-semibold text-gray-900">Unlock Your Vault</h2>
            <p className="mt-1 text-sm text-gray-500">
              Enter your master password to access your passwords
            </p>
          </div>

          {unlockError && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {unlockError}
            </div>
          )}

          <form onSubmit={handleUnlock}>
            <input
              type="password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder="Master Password"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-vault-500 focus:border-vault-500"
              autoFocus
            />
            <button
              type="submit"
              disabled={isUnlocking || !masterPassword}
              className="mt-4 w-full py-3 px-4 bg-vault-600 text-white rounded-lg hover:bg-vault-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-vault-500 disabled:opacity-50"
            >
              {isUnlocking ? 'Unlocking...' : 'Unlock'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Show create org screen if no orgs
  if (organizations.length === 0 || showCreateOrg) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {organizations.length === 0 ? 'Create Your First Vault' : 'Create New Vault'}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            Organizations (vaults) let you group and share passwords with your team.
          </p>

          <form onSubmit={handleCreateOrg}>
            <input
              type="text"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="Organization name (e.g., 'My Nonprofit')"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-vault-500 focus:border-vault-500"
              autoFocus
            />
            <div className="mt-4 flex space-x-3">
              {organizations.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCreateOrg(false)}
                  className="flex-1 py-3 px-4 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={isCreatingOrg || !newOrgName.trim()}
                className="flex-1 py-3 px-4 bg-vault-600 text-white rounded-lg hover:bg-vault-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-vault-500 disabled:opacity-50"
              >
                {isCreatingOrg ? 'Creating...' : 'Create Vault'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Passwords</h1>
          <p className="text-sm text-gray-500 mt-1">
            {secrets.length} {secrets.length === 1 ? 'credential' : 'credentials'} in {currentOrg?.name}
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowCreateOrg(true)}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            + New Vault
          </button>
          <Link
            to="/secrets/new"
            className="inline-flex items-center px-4 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-vault-500"
          >
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Password
          </Link>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="mb-6 space-y-3">
        <div className="flex gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search passwords..."
              className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-vault-500 focus:border-vault-500"
            />
          </div>
          
          {/* Filter Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2 border rounded-lg flex items-center gap-2 transition-colors ${
              showFilters || activeFilterCount > 0
                ? 'border-vault-500 bg-vault-50 dark:bg-vault-900 text-vault-600 dark:text-vault-400'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-vault-600 text-white rounded-full">
                {activeFilterCount}
              </span>
            )}
          </button>
          
          {/* Sort Dropdown */}
          <select
            value={`${sortBy}-${sortDir}`}
            onChange={(e) => {
              const [newSort, newDir] = e.target.value.split('-') as [SortOption, SortDirection];
              setSortBy(newSort);
              setSortDir(newDir);
            }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-vault-500"
          >
            <option value="name-asc">Name (A-Z)</option>
            <option value="name-desc">Name (Z-A)</option>
            <option value="updated-desc">Recently Updated</option>
            <option value="updated-asc">Oldest Updated</option>
            <option value="type-asc">Type (A-Z)</option>
          </select>
          
          {/* Category Manager Button */}
          <button
            onClick={() => setShowCategoryManager(true)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            title="Manage Categories"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </button>
        </div>
        
        {/* Expanded Filters */}
        {showFilters && (
          <div className="flex flex-wrap gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            {/* Type Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Type</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as SecretType | 'all')}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-vault-500"
              >
                <option value="all">All Types</option>
                <option value="password">Passwords</option>
                <option value="note">Secure Notes</option>
                <option value="api_key">API Keys</option>
                <option value="card">Cards</option>
                <option value="totp">2FA Codes</option>
              </select>
            </div>
            
            {/* Favorites Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Show</label>
              <button
                onClick={() => setFilterFavorites(!filterFavorites)}
                className={`px-3 py-2 border rounded-lg text-sm flex items-center gap-2 transition-colors ${
                  filterFavorites
                    ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-400'
                    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <svg className="w-4 h-4" fill={filterFavorites ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                Favorites Only
              </button>
            </div>
            
            {/* Clear Filters */}
            {activeFilterCount > 0 && (
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setFilterType('all');
                    setFilterFavorites(false);
                  }}
                  className="px-3 py-2 text-sm text-vault-600 dark:text-vault-400 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12">
          <svg
            className="animate-spin mx-auto h-8 w-8 text-vault-600"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="mt-2 text-gray-500">Loading passwords...</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredSecrets.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            {searchQuery ? 'No matching passwords' : 'No passwords yet'}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {searchQuery
              ? 'Try a different search term'
              : 'Add your first password to get started'}
          </p>
          {!searchQuery && (
            <Link
              to="/secrets/new"
              className="mt-4 inline-flex items-center px-4 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700"
            >
              Add Password
            </Link>
          )}
        </div>
      )}

      {/* Secrets Grid */}
      {!isLoading && filteredSecrets.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredSecrets.map((secret) => (
            <button
              key={secret.id}
              onClick={() => setSelectedSecretId(secret.id)}
              className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:border-vault-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-10 h-10 bg-vault-100 rounded-lg flex items-center justify-center">
                  <span className="text-vault-600 font-semibold text-lg">
                    {secret.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-gray-900 truncate">{secret.name}</h3>
                  {secret.url && (
                    <p className="text-xs text-gray-500 truncate mt-0.5">{secret.url}</p>
                  )}
                  {secret.usernameHint && (
                    <p className="text-xs text-gray-400 truncate mt-0.5">{secret.usernameHint}</p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Secret View Modal */}
      {selectedSecretId && (
        <SecretView
          secretId={selectedSecretId}
          onClose={() => setSelectedSecretId(null)}
        />
      )}
      
      {/* Category Manager Modal */}
      <CategoryManager
        isOpen={showCategoryManager}
        onClose={() => setShowCategoryManager(false)}
      />
    </div>
  );
}
