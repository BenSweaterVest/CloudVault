/**
 * Renders its children only when the vault is unlocked and an organization
 * is open. Otherwise shows the unlock screen, or the "create your first
 * organization" screen.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useVault } from '../../hooks/useVault';
import { Alert, Button, Card, Field, LockIcon, Spinner, TextInput, errorMessage } from '../ui/kit';

export function UnlockScreen() {
  const { user } = useAuth();
  const { unlock, isLoading } = useVault();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await unlock(password);
      setPassword('');
    } catch (err) {
      setError(errorMessage(err, 'Incorrect master password'));
    }
  };

  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <div className="mb-6 text-center">
          <LockIcon className="mx-auto h-12 w-12 text-vault-600" />
          <h1 className="mt-3 text-xl font-semibold text-gray-900 dark:text-white">Vault locked</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Enter the master password for {user?.email}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Master password">
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" className="w-full" loading={isLoading}>
            Unlock
          </Button>
        </form>
      </Card>
    </div>
  );
}

function CreateFirstOrg() {
  const { createOrganization, pendingInvites } = useVault();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createOrganization(name.trim());
    } catch (err) {
      setError(errorMessage(err, 'Could not create the organization'));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 py-12">
      {pendingInvites.length > 0 && (
        <Alert tone="info" title="Waiting for approval">
          You have been invited to {pendingInvites.map((p) => p.name).join(', ')}. An admin needs to approve you from their browser
          before you can see its passwords. They may ask for your key fingerprint, which is on your{' '}
          <Link to="/preferences" className="font-medium underline">
            Preferences
          </Link>{' '}
          page.
        </Alert>
      )}
      <Card title="Create an organization" description="An organization is a shared vault. You will be its admin and can invite others.">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Organization name">
            {(id) => <TextInput id={id} required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riverside Food Bank" />}
          </Field>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Create organization
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-gray-500 dark:text-gray-400">
        Are you someone&apos;s emergency contact?{' '}
        <Link to="/emergency" className="font-medium text-vault-600 hover:text-vault-700">
          Open emergency access
        </Link>
      </p>
    </div>
  );
}

export default function VaultGate({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { isUnlocked, organizations, currentOrg, isLoading, error } = useVault();

  if (!isUnlocked) return <UnlockScreen />;
  if (!currentOrg) {
    if (isLoading) {
      return (
        <div className="flex justify-center py-16 text-vault-600">
          <Spinner className="h-8 w-8" />
        </div>
      );
    }
    if (error) return <Alert tone="error">{error}</Alert>;
    if (organizations.length === 0) return <CreateFirstOrg />;
    return null;
  }
  if (adminOnly && currentOrg.role !== 'admin') {
    return <Alert tone="warning">This page is only available to admins of {currentOrg.name}.</Alert>;
  }
  return <>{children}</>;
}
