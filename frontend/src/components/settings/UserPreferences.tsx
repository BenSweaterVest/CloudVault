/**
 * User Preferences Component
 * 
 * Allows users to manage their personal settings:
 * - Theme preferences
 * - Session timeout
 * - Clipboard auto-clear
 * - Display preferences
 * 
 * @module components/settings/UserPreferences
 */

import { useState, useEffect } from 'react';
import { preferencesApi, type UserPreferences } from '../../lib/api';
import { useToast } from '../ui/Toast';
import { useTheme } from '../ui/ThemeProvider';

/**
 * Default preferences
 */
const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  sessionTimeout: 15,
  clipboardClear: 30,
  showFavicons: true,
  compactView: false,
};

export default function UserPreferencesPage() {
  const { success, error: showError } = useToast();
  const { setTheme } = useTheme();
  
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Load preferences on mount
  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    setIsLoading(true);
    try {
      const prefs = await preferencesApi.get();
      setPreferences(prefs);
    } catch (err) {
      // Use defaults if no preferences exist
      setPreferences(DEFAULT_PREFERENCES);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await preferencesApi.update(preferences);
      // Apply theme immediately
      setTheme(preferences.theme);
      success('Preferences saved');
    } catch (err) {
      showError('Failed to save preferences');
    } finally {
      setIsSaving(false);
    }
  };

  const updatePreference = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-vault-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Preferences
      </h1>

      <div className="space-y-8">
        {/* Appearance */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Appearance
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Theme
              </label>
              <select
                value={preferences.theme}
                onChange={(e) => updatePreference('theme', e.target.value as UserPreferences['theme'])}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-vault-500 focus:border-transparent"
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System (auto)</option>
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Choose how CloudVault looks to you
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-gray-900 dark:text-gray-100">Compact View</span>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Show more secrets per page with smaller cards
                </p>
              </div>
              <button
                type="button"
                onClick={() => updatePreference('compactView', !preferences.compactView)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-vault-500 focus:ring-offset-2 ${
                  preferences.compactView ? 'bg-vault-600' : 'bg-gray-200 dark:bg-gray-700'
                }`}
                role="switch"
                aria-checked={preferences.compactView}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    preferences.compactView ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-gray-900 dark:text-gray-100">Show Favicons</span>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Display website icons next to passwords
                </p>
              </div>
              <button
                type="button"
                onClick={() => updatePreference('showFavicons', !preferences.showFavicons)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-vault-500 focus:ring-offset-2 ${
                  preferences.showFavicons ? 'bg-vault-600' : 'bg-gray-200 dark:bg-gray-700'
                }`}
                role="switch"
                aria-checked={preferences.showFavicons}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    preferences.showFavicons ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Security */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Security
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Auto-lock Timeout
              </label>
              <select
                value={preferences.sessionTimeout}
                onChange={(e) => updatePreference('sessionTimeout', Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-vault-500 focus:border-transparent"
              >
                <option value={1}>1 minute</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Automatically lock your vault after inactivity
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Clipboard Auto-clear
              </label>
              <select
                value={preferences.clipboardClear}
                onChange={(e) => updatePreference('clipboardClear', Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-vault-500 focus:border-transparent"
              >
                <option value={0}>Disabled</option>
                <option value={10}>10 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
                <option value={300}>5 minutes</option>
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Clear copied passwords from clipboard after a delay
              </p>
            </div>
          </div>
        </section>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700 disabled:opacity-50 transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}
