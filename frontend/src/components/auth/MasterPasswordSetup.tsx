/**
 * First-time setup: choose a master password, generate the key pair, and
 * show the key fingerprint the user will read to an admin for approval.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { authApi } from '../../lib/api';
import { keyFingerprint, setupUserKeys } from '../../lib/crypto';
import { assessMasterPassword } from '../../lib/passwords';
import { Alert, AuthShell, Button, Checkbox, Field, Fingerprint, FullPageSpinner, TextInput, errorMessage } from '../ui/kit';

export const MIN_MASTER_PASSWORD_LENGTH = 12;

export default function MasterPasswordSetup() {
  const { user, isLoading, needsKeySetup, updateUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    if (user?.publicKey && !needsKeySetup) void keyFingerprint(user.publicKey).then(setFingerprint);
  }, [user, needsKeySetup]);

  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  // Finished: show the fingerprint once, then continue.
  if (!needsKeySetup) {
    return (
      <AuthShell title="Your vault is ready" subtitle="Here is your key fingerprint">
        <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300">
          <div className="text-center">
            <Fingerprint value={fingerprint} />
          </div>
          <p>
            If an admin invited you, they will ask you for this fingerprint before approving you. Read it to them over a call or
            in person. You can find it again later under Preferences.
          </p>
          <Button className="w-full" onClick={() => navigate('/', { replace: true })}>
            Continue
          </Button>
        </div>
      </AuthShell>
    );
  }

  const strength = assessMasterPassword(password);
  const tooShort = password.length < MIN_MASTER_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = !tooShort && !mismatch && confirm === password && acknowledged && strength.score >= 2;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const keys = await setupUserKeys(password);
      updateUser(await authApi.setupKeys(keys));
    } catch (err) {
      setError(errorMessage(err, 'Could not set up your keys'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your master password" subtitle="It encrypts your keys on this device. CloudVault never sees it.">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field
          label="Master password"
          hint={`At least ${MIN_MASTER_PASSWORD_LENGTH} characters. A few unrelated words make a strong, memorable password.`}
        >
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>

        {password && (
          <div aria-live="polite">
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full ${i < strength.score ? strength.barClass : 'bg-gray-200 dark:bg-gray-700'}`} />
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {strength.label}
              {strength.feedback ? `: ${strength.feedback}` : ''}
            </p>
          </div>
        )}

        <Field label="Confirm master password" error={mismatch ? 'Passwords do not match' : null}>
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
        </Field>

        <Alert tone="warning" title="There is no password reset">
          If you forget your master password, nobody (including admins) can recover your keys. An admin can re-invite you
          after you set up a new one.
        </Alert>
        <Checkbox label="I understand and have stored my master password safely" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />

        <Button type="submit" className="w-full py-3" loading={busy} disabled={!canSubmit}>
          {busy ? 'Generating keys...' : 'Create my keys'}
        </Button>
      </form>
    </AuthShell>
  );
}
