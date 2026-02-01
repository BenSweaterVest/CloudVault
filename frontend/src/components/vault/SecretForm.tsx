/**
 * Secret Form Component
 *
 * Create and edit secrets/passwords with full dark mode support.
 *
 * @module components/vault/SecretForm
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useVault } from '../../hooks/useVault';

// Password strength thresholds
const PASSWORD_LENGTH_MIN = 8;
const PASSWORD_LENGTH_GOOD = 12;
const PASSWORD_LENGTH_STRONG = 16;
const UNIQUE_CHAR_RATIO = 0.7;

/**
 * Calculate password strength score and feedback
 */
function calculatePasswordStrength(password: string): {
  score: number;
  label: string;
  color: string;
  feedback: string[];
} {
  if (!password) {
    return { score: 0, label: 'None', color: 'gray', feedback: [] };
  }

  let score = 0;
  const feedback: string[] = [];

  // Length checks
  if (password.length >= PASSWORD_LENGTH_MIN) score += 1;
  if (password.length >= PASSWORD_LENGTH_GOOD) score += 1;
  if (password.length >= PASSWORD_LENGTH_STRONG) score += 1;
  if (password.length < PASSWORD_LENGTH_MIN) feedback.push(`Use at least ${PASSWORD_LENGTH_MIN} characters`);

  // Character type checks
  if (/[a-z]/.test(password)) score += 1;
  else feedback.push('Add lowercase letters');
  
  if (/[A-Z]/.test(password)) score += 1;
  else feedback.push('Add uppercase letters');
  
  if (/[0-9]/.test(password)) score += 1;
  else feedback.push('Add numbers');
  
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  else feedback.push('Add special characters');

  // Bonus for variety
  const uniqueChars = new Set(password).size;
  if (uniqueChars >= password.length * UNIQUE_CHAR_RATIO) score += 1;

  // Convert to 0-4 scale
  const normalizedScore = Math.min(4, Math.floor(score / 2));

  const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const colors = ['red', 'orange', 'yellow', 'lime', 'green'];

  return {
    score: normalizedScore,
    label: labels[normalizedScore],
    color: colors[normalizedScore],
    feedback: feedback.slice(0, 2), // Show max 2 suggestions
  };
}

/**
 * Password strength indicator component
 */
function PasswordStrengthIndicator({ password }: { password: string }) {
  const strength = useMemo(() => calculatePasswordStrength(password), [password]);
  
  const colorClasses = {
    gray: 'bg-gray-200 dark:bg-gray-700',
    red: 'bg-red-500',
    orange: 'bg-orange-500',
    yellow: 'bg-yellow-500',
    lime: 'bg-lime-500',
    green: 'bg-green-500',
  };
  
  const textColors = {
    gray: 'text-gray-500 dark:text-gray-400',
    red: 'text-red-600 dark:text-red-400',
    orange: 'text-orange-600 dark:text-orange-400',
    yellow: 'text-yellow-600 dark:text-yellow-400',
    lime: 'text-lime-600 dark:text-lime-400',
    green: 'text-green-600 dark:text-green-400',
  };

  return (
    <div className="mt-2" role="status" aria-live="polite">
      {/* Strength Bar */}
      <div className="flex gap-1 mb-1">
        {[0, 1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={`h-1 flex-1 rounded-full transition-colors ${
              level <= strength.score
                ? colorClasses[strength.color as keyof typeof colorClasses]
                : 'bg-gray-200 dark:bg-gray-700'
            }`}
          />
        ))}
      </div>
      
      {/* Strength Label and Feedback */}
      <div className="flex items-center justify-between text-xs">
        <span className={textColors[strength.color as keyof typeof textColors]}>
          {strength.label}
        </span>
        {strength.feedback.length > 0 && (
          <span className="text-gray-500 dark:text-gray-400">
            {strength.feedback[0]}
          </span>
        )}
      </div>
    </div>
  );
}

export default function SecretForm() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { secrets, currentOrg, createSecret, updateSecret, decryptSecretData } = useVault();
  
  const isEditing = !!id;
  const existingSecret = isEditing ? secrets.find((s) => s.id === id) : null;

  const [formData, setFormData] = useState({
    name: '',
    url: '',
    usernameHint: '',
    username: '',
    password: '',
    notes: '',
  });
  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Load existing secret data for editing
  useEffect(() => {
    if (isEditing && existingSecret) {
      decryptSecretData(existingSecret)
        .then((data) => {
          setFormData({
            name: existingSecret.name,
            url: existingSecret.url || '',
            usernameHint: existingSecret.usernameHint || '',
            username: data.username,
            password: data.password,
            notes: data.notes || '',
          });
          setIsLoading(false);
        })
        .catch((err) => {
          setError(err.message || 'Failed to load secret');
          setIsLoading(false);
        });
    }
  }, [isEditing, existingSecret, decryptSecretData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!formData.name.trim()) {
      setError('Name is required');
      return;
    }
    
    if (!formData.username.trim()) {
      setError('Username is required');
      return;
    }
    
    if (!formData.password) {
      setError('Password is required');
      return;
    }
    
    setIsSaving(true);
    
    try {
      if (isEditing && id) {
        await updateSecret(id, {
          name: formData.name,
          url: formData.url || undefined,
          usernameHint: formData.usernameHint || undefined,
          username: formData.username,
          password: formData.password,
          notes: formData.notes || undefined,
        });
      } else {
        await createSecret({
          name: formData.name,
          url: formData.url || undefined,
          usernameHint: formData.usernameHint || undefined,
          username: formData.username,
          password: formData.password,
          notes: formData.notes || undefined,
        });
      }
      
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save secret');
    } finally {
      setIsSaving(false);
    }
  };

  const generatePassword = () => {
    const length = 20;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    const randomValues = new Uint32Array(length);
    crypto.getRandomValues(randomValues);
    const password = Array.from(randomValues)
      .map((val) => charset[val % charset.length])
      .join('');
    setFormData((prev) => ({ ...prev, password }));
    setShowPassword(true);
  };

  if (!currentOrg) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">Please select an organization first.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <svg
          className="animate-spin mx-auto h-8 w-8 text-vault-600"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="mt-2 text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          aria-label="Go back to passwords list"
        >
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to passwords
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          {isEditing ? 'Edit Password' : 'Add New Password'}
        </h1>

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Company Bank Account"
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-vault-500 focus:border-vault-500"
              autoFocus
              required
              aria-required="true"
            />
          </div>

          {/* URL */}
          <div>
            <label htmlFor="url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Website URL
            </label>
            <input
              id="url"
              type="text"
              value={formData.url}
              onChange={(e) => setFormData((prev) => ({ ...prev, url: e.target.value }))}
              placeholder="e.g., chase.com"
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-vault-500 focus:border-vault-500"
            />
          </div>

          {/* Username */}
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Username / Email <span className="text-red-500">*</span>
            </label>
            <input
              id="username"
              type="text"
              value={formData.username}
              onChange={(e) => {
                setFormData((prev) => ({
                  ...prev,
                  username: e.target.value,
                  usernameHint: e.target.value,
                }));
              }}
              placeholder="e.g., treasurer@nonprofit.org"
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-vault-500 focus:border-vault-500"
              required
              aria-required="true"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              This will be shown in the list for easy identification
            </p>
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password <span className="text-red-500">*</span>
            </label>
            <div className="flex space-x-2">
              <div className="relative flex-1">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Enter password"
                  className="w-full px-4 py-3 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-vault-500 focus:border-vault-500 font-mono"
                  required
                  aria-required="true"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={generatePassword}
                className="px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 whitespace-nowrap"
                aria-label="Generate secure password"
              >
                Generate
              </button>
            </div>
            
            {/* Password Strength Indicator */}
            {formData.password && (
              <PasswordStrengthIndicator password={formData.password} />
            )}
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Notes
            </label>
            <textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Security questions, recovery codes, etc."
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-vault-500 focus:border-vault-500"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100 dark:border-gray-700">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-3 bg-vault-600 text-white rounded-lg hover:bg-vault-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-vault-500 dark:focus:ring-offset-gray-800 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
