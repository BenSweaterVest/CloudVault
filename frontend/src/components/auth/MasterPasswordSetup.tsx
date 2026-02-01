/**
 * Master Password Setup Component
 * 
 * Handles first-time setup of encryption keys after OAuth login.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { authApi } from '../../lib/api';
import { setupUserKeys } from '../../lib/crypto';

export default function MasterPasswordSetup() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordStrength = getPasswordStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    if (password.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Generate keys and encrypt private key with master password
      const keys = await setupUserKeys(password);
      
      // Send to server
      const updatedUser = await authApi.setupKeys({
        publicKey: keys.publicKey,
        encryptedPrivateKey: keys.encryptedPrivateKey,
        salt: keys.salt,
      });
      
      // Update auth context
      updateUser(updatedUser);
      
      // Navigate to main app
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set up encryption keys');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="flex justify-center">
            <svg
              className="h-16 w-16 text-vault-600"
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
          </div>
          <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
            Create Your Master Password
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Welcome, <strong>{user?.email}</strong>! Create a master password to encrypt your vault.
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex">
            <svg
              className="h-5 w-5 text-amber-400 mt-0.5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-amber-800">Important</h3>
              <p className="mt-1 text-sm text-amber-700">
                This password encrypts your vault. If you forget it, <strong>you will lose access to all passwords</strong>. 
                We cannot recover it for you.
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Master Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 appearance-none block w-full px-3 py-3 border border-gray-300 rounded-lg placeholder-gray-400 focus:outline-none focus:ring-vault-500 focus:border-vault-500 sm:text-sm"
              placeholder="Enter a strong master password"
            />
            
            {/* Password Strength Indicator */}
            {password && (
              <div className="mt-2">
                <div className="flex space-x-1">
                  {[1, 2, 3, 4].map((level) => (
                    <div
                      key={level}
                      className={`h-1 flex-1 rounded ${
                        passwordStrength >= level
                          ? passwordStrength === 1
                            ? 'bg-red-500'
                            : passwordStrength === 2
                            ? 'bg-orange-500'
                            : passwordStrength === 3
                            ? 'bg-yellow-500'
                            : 'bg-green-500'
                          : 'bg-gray-200'
                      }`}
                    />
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {passwordStrength === 1 && 'Weak - add more characters'}
                  {passwordStrength === 2 && 'Fair - try adding numbers or symbols'}
                  {passwordStrength === 3 && 'Good - consider making it longer'}
                  {passwordStrength === 4 && 'Strong password'}
                </p>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">
              Confirm Master Password
            </label>
            <input
              id="confirm-password"
              name="confirm-password"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 appearance-none block w-full px-3 py-3 border border-gray-300 rounded-lg placeholder-gray-400 focus:outline-none focus:ring-vault-500 focus:border-vault-500 sm:text-sm"
              placeholder="Confirm your master password"
            />
            {confirmPassword && password !== confirmPassword && (
              <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
            )}
          </div>

          <div className="text-sm text-gray-500">
            <p>Your master password should:</p>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li className={password.length >= 12 ? 'text-green-600' : ''}>
                Be at least 12 characters long
              </li>
              <li className={/[A-Z]/.test(password) && /[a-z]/.test(password) ? 'text-green-600' : ''}>
                Include uppercase and lowercase letters
              </li>
              <li className={/[0-9]/.test(password) ? 'text-green-600' : ''}>
                Include numbers
              </li>
              <li className={/[^A-Za-z0-9]/.test(password) ? 'text-green-600' : ''}>
                Include special characters
              </li>
            </ul>
          </div>

          <button
            type="submit"
            disabled={isLoading || password.length < 12 || password !== confirmPassword}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-vault-600 hover:bg-vault-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-vault-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="flex items-center">
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Setting up encryption...
              </span>
            ) : (
              'Create Master Password'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

function getPasswordStrength(password: string): number {
  if (!password) return 0;
  
  let strength = 0;
  
  if (password.length >= 8) strength++;
  if (password.length >= 12) strength++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) strength++;
  if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) strength++;
  
  return Math.min(strength, 4);
}
