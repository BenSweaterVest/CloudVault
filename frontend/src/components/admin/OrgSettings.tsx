/**
 * Organization Settings Component
 * 
 * Configure organization-wide security policies and defaults.
 */

import { useState, useEffect } from 'react';
import { useVault } from '../../hooks/useVault';
import { useToast } from '../ui/Toast';
import { Skeleton } from '../ui/Skeleton';

interface OrgSettings {
  require2fa: boolean;
  minPasswordLength: number;
  passwordExpiryDays: number;
  allowShareLinks: boolean;
  shareLinkMaxHours: number;
  allowEmergencyAccess: boolean;
  emergencyWaitMinHours: number;
  auditRetentionDays: number;
}

export default function OrgSettings() {
  const { currentOrg } = useVault();
  const { success, error } = useToast();
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    
    const fetchSettings = async () => {
      setIsLoading(true);
      try {
        const token = localStorage.getItem('cloudvault_token');
        const response = await fetch(`/api/organizations/${currentOrg.id}/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        if (!response.ok) throw new Error('Failed to fetch settings');
        
        const data = await response.json();
        setSettings(data);
      } catch (err) {
        error('Load Failed', (err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, [currentOrg, error]);

  const saveSettings = async () => {
    if (!settings || !currentOrg) return;
    
    setIsSaving(true);
    try {
      const token = localStorage.getItem('cloudvault_token');
      const response = await fetch(`/api/organizations/${currentOrg.id}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to save settings');
      }

      const updated = await response.json();
      setSettings(updated);
      success('Settings Saved', 'Organization settings have been updated');
    } catch (err) {
      error('Save Failed', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const updateSetting = <K extends keyof OrgSettings>(key: K, value: OrgSettings[K]) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Organization Settings
        </h2>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Configure security policies and defaults for {currentOrg?.name}
        </p>
      </div>

      {/* Password Policies */}
      <SettingsSection
        title="Password Policies"
        description="Configure password requirements and rotation"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Minimum Password Length
            </label>
            <select
              value={settings.minPasswordLength}
              onChange={(e) => updateSetting('minPasswordLength', Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              {[8, 12, 16, 20, 24, 32].map((len) => (
                <option key={len} value={len}>{len} characters</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              For generated passwords
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Default Password Expiry
            </label>
            <select
              value={settings.passwordExpiryDays}
              onChange={(e) => updateSetting('passwordExpiryDays', Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              <option value={0}>No expiry</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>1 year</option>
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Applied to new passwords
            </p>
          </div>
        </div>
      </SettingsSection>

      {/* Sharing Settings */}
      <SettingsSection
        title="Share Links"
        description="Control how secrets can be shared externally"
      >
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={settings.allowShareLinks}
              onChange={(e) => updateSetting('allowShareLinks', e.target.checked)}
              className="rounded border-gray-300 text-vault-600 focus:ring-vault-500 h-5 w-5"
            />
            <div>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                Enable Share Links
              </span>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Allow members to create temporary share links for secrets
              </p>
            </div>
          </label>

          {settings.allowShareLinks && (
            <div className="ml-8">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Maximum Link Duration
              </label>
              <select
                value={settings.shareLinkMaxHours}
                onChange={(e) => updateSetting('shareLinkMaxHours', Number(e.target.value))}
                className="w-full max-w-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value={24}>1 day</option>
                <option value={48}>2 days</option>
                <option value={72}>3 days</option>
                <option value={168}>1 week</option>
                <option value={336}>2 weeks</option>
                <option value={720}>30 days</option>
              </select>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* Emergency Access */}
      <SettingsSection
        title="Emergency Access"
        description="Configure trusted contact emergency access"
      >
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={settings.allowEmergencyAccess}
              onChange={(e) => updateSetting('allowEmergencyAccess', e.target.checked)}
              className="rounded border-gray-300 text-vault-600 focus:ring-vault-500 h-5 w-5"
            />
            <div>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                Enable Emergency Access
              </span>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Allow members to designate trusted contacts for emergency access
              </p>
            </div>
          </label>

          {settings.allowEmergencyAccess && (
            <div className="ml-8">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Minimum Wait Period
              </label>
              <select
                value={settings.emergencyWaitMinHours}
                onChange={(e) => updateSetting('emergencyWaitMinHours', Number(e.target.value))}
                className="w-full max-w-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value={24}>24 hours (1 day)</option>
                <option value={48}>48 hours (2 days)</option>
                <option value={72}>72 hours (3 days)</option>
                <option value={168}>168 hours (1 week)</option>
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Time before emergency access is granted (can be denied during this period)
              </p>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* Audit & Compliance */}
      <SettingsSection
        title="Audit & Compliance"
        description="Configure audit log retention"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Audit Log Retention
          </label>
          <select
            value={settings.auditRetentionDays}
            onChange={(e) => updateSetting('auditRetentionDays', Number(e.target.value))}
            className="w-full max-w-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>1 year</option>
            <option value={730}>2 years</option>
          </select>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Audit logs older than this will be automatically deleted
          </p>
        </div>
      </SettingsSection>

      {/* Two-Factor Authentication */}
      <SettingsSection
        title="Two-Factor Authentication"
        description="Require 2FA for organization members"
      >
        <label className="flex items-center gap-3 opacity-60 cursor-not-allowed">
          <input
            type="checkbox"
            checked={settings.require2fa}
            onChange={(e) => updateSetting('require2fa', e.target.checked)}
            disabled
            className="rounded border-gray-300 text-vault-600 focus:ring-vault-500 h-5 w-5"
          />
          <div>
            <span className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
              Require Two-Factor Authentication
              <span className="text-xs px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 rounded-full">
                Coming Soon
              </span>
            </span>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              All members must set up 2FA to access the vault
            </p>
          </div>
        </label>
      </SettingsSection>

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={saveSettings}
          disabled={isSaving}
          className="px-6 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

interface SettingsSectionProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{description}</p>
      {children}
    </div>
  );
}
