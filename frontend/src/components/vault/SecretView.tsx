/**
 * Secret View Modal
 * 
 * Displays decrypted secret details with copy functionality.
 * Supports favorites toggle, TOTP display, share links, and version history.
 * 
 * @module components/vault/SecretView
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVault } from '../../hooks/useVault';
import { secretsApi, type Secret, type SecretHistory } from '../../lib/api';
import { useToast } from '../ui/Toast';
import TOTPDisplay from './TOTPDisplay';
import ShareModal from './ShareModal';

/**
 * Props for SecretView component
 */
interface SecretViewProps {
  /** Secret ID to display */
  secretId: string;
  /** Callback when modal is closed */
  onClose: () => void;
}

/**
 * Decrypted secret data structure
 */
interface DecryptedData {
  username: string;
  password: string;
  notes?: string;
  totpSecret?: string;
  totpIssuer?: string;
}

/**
 * Available tabs in the secret view
 */
type ViewTab = 'details' | 'history';

export default function SecretView({ secretId, onClose }: SecretViewProps) {
  const { secrets, currentOrg, decryptSecretData, deleteSecret, loadSecrets } = useVault();
  const navigate = useNavigate();
  const { success, error: showError } = useToast();
  
  const [decryptedData, setDecryptedData] = useState<DecryptedData | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'username' | 'password' | 'totp' | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isFavoriteLoading, setIsFavoriteLoading] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>('details');
  const [history, setHistory] = useState<SecretHistory[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const secret = secrets.find((s) => s.id === secretId);

  useEffect(() => {
    if (!secret) {
      setError('Secret not found');
      setIsLoading(false);
      return;
    }

    decryptSecretData(secret)
      .then((data) => {
        setDecryptedData(data);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to decrypt secret');
        setIsLoading(false);
      });
  }, [secret, decryptSecretData]);

  /**
   * Load secret history when history tab is selected
   */
  const loadHistory = useCallback(async () => {
    if (!currentOrg || !secret) return;
    
    setIsHistoryLoading(true);
    try {
      const data = await secretsApi.getHistory(currentOrg.id, secretId);
      setHistory(data);
    } catch (err) {
      showError('Failed to load history');
    } finally {
      setIsHistoryLoading(false);
    }
  }, [currentOrg, secret, secretId, showError]);

  useEffect(() => {
    if (activeTab === 'history' && history.length === 0 && !isHistoryLoading) {
      loadHistory();
    }
  }, [activeTab, history.length, isHistoryLoading, loadHistory]);

  /**
   * Copy text to clipboard
   */
  const copyToClipboard = async (text: string, type: 'username' | 'password' | 'totp') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  /**
   * Toggle favorite status
   */
  const handleToggleFavorite = async () => {
    if (!currentOrg || !secret) return;
    
    setIsFavoriteLoading(true);
    try {
      await secretsApi.toggleFavorite(currentOrg.id, secretId, !secret.isFavorite);
      await loadSecrets();
      success(secret.isFavorite ? 'Removed from favorites' : 'Added to favorites');
    } catch (err) {
      showError('Failed to update favorite');
    } finally {
      setIsFavoriteLoading(false);
    }
  };

  /**
   * Delete the secret
   */
  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteSecret(secretId);
      success('Secret deleted');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete secret');
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * Navigate to edit page
   */
  const handleEdit = () => {
    navigate(`/secrets/${secretId}/edit`);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black bg-opacity-30 transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div 
          className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="secret-view-title"
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {isLoading && (
            <div className="py-12 text-center">
              <svg
                className="animate-spin mx-auto h-8 w-8 text-vault-600"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="mt-2 text-gray-500">Decrypting...</p>
            </div>
          )}

          {error && (
            <div className="py-8 text-center">
              <p className="text-red-600">{error}</p>
              <button
                onClick={onClose}
                className="mt-4 text-vault-600 hover:text-vault-700"
              >
                Close
              </button>
            </div>
          )}

          {!isLoading && !error && secret && decryptedData && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-vault-100 dark:bg-vault-900 rounded-lg flex items-center justify-center">
                    <span className="text-vault-600 dark:text-vault-400 font-bold text-xl">
                      {secret.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{secret.name}</h2>
                    {secret.url && (
                      <a
                        href={secret.url.startsWith('http') ? secret.url : `https://${secret.url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-vault-600 dark:text-vault-400 hover:underline"
                      >
                        {secret.url}
                      </a>
                    )}
                  </div>
                </div>
                {/* Favorite & Share buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleFavorite}
                    disabled={isFavoriteLoading}
                    className={`p-2 rounded-lg transition-colors ${
                      secret.isFavorite
                        ? 'text-yellow-500 hover:text-yellow-600'
                        : 'text-gray-400 hover:text-gray-500 dark:hover:text-gray-300'
                    }`}
                    title={secret.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <svg className="w-5 h-5" fill={secret.isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setShowShareModal(true)}
                    className="p-2 rounded-lg text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors"
                    title="Share"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
                <button
                  onClick={() => setActiveTab('details')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'details'
                      ? 'border-vault-500 text-vault-600 dark:text-vault-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                  }`}
                >
                  Details
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'history'
                      ? 'border-vault-500 text-vault-600 dark:text-vault-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                  }`}
                >
                  History
                </button>
              </div>

              {/* Details Tab */}
              {activeTab === 'details' && (
                <div className="space-y-4">
                  {/* TOTP Display (for TOTP secrets) */}
                  {secret.secretType === 'totp' && decryptedData.totpSecret && (
                    <TOTPDisplay
                      secret={decryptedData.totpSecret}
                      issuer={decryptedData.totpIssuer || secret.name}
                      accountName={decryptedData.username}
                      onCopy={(code) => copyToClipboard(code, 'totp')}
                    />
                  )}

                  {/* Username */}
                  {decryptedData.username && (
                    <div>
                      <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Username / Email
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          readOnly
                          value={decryptedData.username}
                          className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100"
                        />
                        <button
                          onClick={() => copyToClipboard(decryptedData.username, 'username')}
                          className={`p-2 rounded-lg border transition-colors ${
                            copied === 'username'
                              ? 'bg-green-50 dark:bg-green-900 border-green-200 dark:border-green-700 text-green-600 dark:text-green-400'
                              : 'border-gray-200 dark:border-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300'
                          }`}
                          title="Copy username"
                        >
                          {copied === 'username' ? (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Password (not shown for TOTP-only secrets) */}
                  {decryptedData.password && secret.secretType !== 'totp' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Password
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          readOnly
                          value={decryptedData.password}
                          className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 font-mono"
                        />
                        <button
                          onClick={() => setShowPassword(!showPassword)}
                          className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300"
                          title={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => copyToClipboard(decryptedData.password, 'password')}
                          className={`p-2 rounded-lg border transition-colors ${
                            copied === 'password'
                              ? 'bg-green-50 dark:bg-green-900 border-green-200 dark:border-green-700 text-green-600 dark:text-green-400'
                              : 'border-gray-200 dark:border-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300'
                          }`}
                          title="Copy password"
                        >
                          {copied === 'password' ? (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  {decryptedData.notes && (
                    <div>
                      <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Notes
                      </label>
                      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 text-sm whitespace-pre-wrap">
                        {decryptedData.notes}
                      </div>
                    </div>
                  )}

                  {/* Category & Tags */}
                  {(secret.categoryName || secret.tags?.length > 0) && (
                    <div className="flex flex-wrap gap-2">
                      {secret.categoryName && (
                        <span 
                          className="px-2 py-1 text-xs rounded-full"
                          style={{ 
                            backgroundColor: (secret.categoryColor || '#6366f1') + '20',
                            color: secret.categoryColor || '#6366f1'
                          }}
                        >
                          {secret.categoryName}
                        </span>
                      )}
                      {secret.tags?.map((tag) => (
                        <span key={tag} className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Meta */}
                  <div className="pt-4 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
                    <p>Version {secret.version} • Last updated {new Date(secret.updatedAt).toLocaleDateString()}</p>
                    {secret.expiresAt && (
                      <p className={new Date(secret.expiresAt) < new Date() ? 'text-red-500' : ''}>
                        {new Date(secret.expiresAt) < new Date() ? 'Expired' : 'Expires'} {new Date(secret.expiresAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* History Tab */}
              {activeTab === 'history' && (
                <div className="space-y-3">
                  {isHistoryLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin mx-auto w-6 h-6 border-2 border-vault-600 border-t-transparent rounded-full" />
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading history...</p>
                    </div>
                  ) : history.length === 0 ? (
                    <p className="text-center py-8 text-gray-500 dark:text-gray-400">No history available</p>
                  ) : (
                    history.map((entry, index) => (
                      <div
                        key={entry.id}
                        className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              Version {entry.version}
                            </span>
                            {index === 0 && (
                              <span className="px-2 py-0.5 text-xs bg-vault-100 dark:bg-vault-900 text-vault-600 dark:text-vault-400 rounded">
                                Current
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(entry.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Changed by {entry.changedByEmail}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="mt-6 flex justify-between">
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm font-medium"
                >
                  Delete
                </button>
                <div className="space-x-3">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    Close
                  </button>
                  <button
                    onClick={handleEdit}
                    className="px-4 py-2 text-white bg-vault-600 rounded-lg hover:bg-vault-700"
                  >
                    Edit
                  </button>
                </div>
              </div>

              {/* Delete Confirmation */}
              {showDeleteConfirm && (
                <div className="absolute inset-0 bg-white dark:bg-gray-800 rounded-xl p-6 flex flex-col items-center justify-center">
                  <svg
                    className="w-12 h-12 text-red-500 mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete this password?</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-6">
                    This action cannot be undone. The password history will also be deleted.
                  </p>
                  <div className="flex space-x-3">
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                      {isDeleting ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Share Modal */}
      {showShareModal && secret && currentOrg && (
        <ShareModal
          secretId={secret.id}
          secretName={secret.name}
          orgId={currentOrg.id}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
}
