/**
 * Share Modal Component
 * 
 * Creates temporary, secure share links for secrets.
 */

import { useState } from 'react';
import { useToast } from '../ui/Toast';
import { FocusTrap } from '../ui/Accessibility';

interface ShareModalProps {
  secretId: string;
  secretName: string;
  orgId: string;
  onClose: () => void;
}

interface ShareLink {
  id: string;
  url: string;
  expiresAt: string;
  maxViews: number;
  hasPassword: boolean;
  allowCopy: boolean;
  recipientEmail?: string;
}

export default function ShareModal({ secretId, secretName, orgId, onClose }: ShareModalProps) {
  const { success, error } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<ShareLink | null>(null);
  const [copied, setCopied] = useState(false);
  
  // Form state
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [maxViews, setMaxViews] = useState(1);
  const [usePassword, setUsePassword] = useState(false);
  const [accessPassword, setAccessPassword] = useState('');
  const [allowCopy, setAllowCopy] = useState(true);
  const [recipientEmail, setRecipientEmail] = useState('');

  const handleCreate = async () => {
    if (usePassword && accessPassword.length < 4) {
      error('Password Required', 'Please enter a password of at least 4 characters');
      return;
    }

    setIsCreating(true);
    try {
      const token = localStorage.getItem('cloudvault_token');
      const response = await fetch(`/api/organizations/${orgId}/secrets/${secretId}/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          expiresInHours,
          maxViews,
          accessPassword: usePassword ? accessPassword : undefined,
          allowCopy,
          recipientEmail: recipientEmail || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to create share link');
      }

      const link = await response.json();
      setCreatedLink(link);
      success('Share Link Created', 'Copy the link to share this secret');
    } catch (err) {
      error('Failed to Create', (err as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  const copyLink = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      error('Copy Failed', 'Could not copy to clipboard');
    }
  };

  const expiryOptions = [
    { value: 1, label: '1 hour' },
    { value: 4, label: '4 hours' },
    { value: 24, label: '1 day' },
    { value: 48, label: '2 days' },
    { value: 168, label: '1 week' },
  ];

  const viewOptions = [
    { value: 1, label: '1 view' },
    { value: 3, label: '3 views' },
    { value: 5, label: '5 views' },
    { value: 10, label: '10 views' },
    { value: 0, label: 'Unlimited' },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-30" onClick={onClose} />
        
        <FocusTrap>
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full p-6">
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-vault-100 dark:bg-vault-900/30 rounded-lg">
                <svg className="w-6 h-6 text-vault-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  Share Secret
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{secretName}</p>
              </div>
            </div>

            {!createdLink ? (
              <>
                <div className="space-y-4">
                  {/* Expiry */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Link Expires In
                    </label>
                    <select
                      value={expiresInHours}
                      onChange={(e) => setExpiresInHours(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      {expiryOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Max Views */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Maximum Views
                    </label>
                    <select
                      value={maxViews}
                      onChange={(e) => setMaxViews(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      {viewOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Recipient Email (optional) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Recipient Email (optional)
                    </label>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="accountant@example.com"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      For your records only - not used for access control
                    </p>
                  </div>

                  {/* Password Protection */}
                  <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={usePassword}
                        onChange={(e) => setUsePassword(e.target.checked)}
                        className="rounded border-gray-300 text-vault-600 focus:ring-vault-500"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Require password to access
                      </span>
                    </label>
                    
                    {usePassword && (
                      <input
                        type="password"
                        value={accessPassword}
                        onChange={(e) => setAccessPassword(e.target.value)}
                        placeholder="Enter access password"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      />
                    )}
                  </div>

                  {/* Allow Copy */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowCopy}
                      onChange={(e) => setAllowCopy(e.target.checked)}
                      className="rounded border-gray-300 text-vault-600 focus:ring-vault-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Allow recipient to copy password
                    </span>
                  </label>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={isCreating}
                    className="px-4 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700 disabled:opacity-50"
                  >
                    {isCreating ? 'Creating...' : 'Create Share Link'}
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Created Link View */}
                <div className="space-y-4">
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <div className="flex items-center gap-2 text-green-700 dark:text-green-300 mb-2">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="font-medium">Share Link Created</span>
                    </div>
                    <p className="text-sm text-green-600 dark:text-green-400">
                      This link will expire {new Date(createdLink.expiresAt).toLocaleString()}
                      {createdLink.maxViews > 0 && ` or after ${createdLink.maxViews} view(s)`}.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Share Link
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={createdLink.url}
                        readOnly
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                      />
                      <button
                        onClick={copyLink}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          copied
                            ? 'bg-green-600 text-white'
                            : 'bg-vault-600 text-white hover:bg-vault-700'
                        }`}
                      >
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  {createdLink.hasPassword && (
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                      <p className="text-sm text-yellow-700 dark:text-yellow-300">
                        <strong>Remember:</strong> Share the access password separately via a different channel.
                      </p>
                    </div>
                  )}

                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-2">Link Details:</h4>
                    <ul className="space-y-1">
                      <li>• Expires: {new Date(createdLink.expiresAt).toLocaleString()}</li>
                      <li>• Max views: {createdLink.maxViews === 0 ? 'Unlimited' : createdLink.maxViews}</li>
                      <li>• Password protected: {createdLink.hasPassword ? 'Yes' : 'No'}</li>
                      <li>• Copy allowed: {createdLink.allowCopy ? 'Yes' : 'No'}</li>
                      {createdLink.recipientEmail && <li>• Intended for: {createdLink.recipientEmail}</li>}
                    </ul>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700"
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </FocusTrap>
      </div>
    </div>
  );
}
