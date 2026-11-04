/**
 * Personal preferences and account security: profile, appearance, auto-lock,
 * clipboard clearing, key fingerprint, master password change, sessions.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { usePreferences } from '../../lib/preferences';
import { authApi, type UserPreferences as Prefs } from '../../lib/api';
import { CURRENT_KDF_ITERATIONS, keyFingerprint, publicKeyFromPrivateKey, unwrapPrivateKey, wrapPrivateKey } from '../../lib/crypto';
import { useVault } from '../../hooks/useVault';
import { assessMasterPassword } from '../../lib/passwords';
import { useTheme, type Theme } from '../ui/ThemeProvider';
import { useToast } from '../ui/Toast';
import { Alert, Button, Card, Checkbox, Field, Fingerprint, PageHeader, Select, TextInput, errorMessage } from '../ui/kit';
import { MIN_MASTER_PASSWORD_LENGTH } from '../auth/MasterPasswordSetup';

function ProfileCard() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      updateUser(await authApi.updateProfile(name.trim() || null));
      toast.success('Profile saved');
    } catch (err) {
      toast.error('Could not save', errorMessage(err));
    }
  };

  return (
    <Card title="Profile" description={user?.email}>
      <form onSubmit={save} className="flex gap-2">
        <TextInput aria-label="Display name" placeholder="Display name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit">Save</Button>
      </form>
    </Card>
  );
}

function PreferencesCard() {
  const { preferences, update } = usePreferences();
  const { theme, setTheme } = useTheme();
  const toast = useToast();

  const change = async (changes: Partial<Prefs>) => {
    try {
      await update(changes);
    } catch (err) {
      toast.error('Could not save preference', errorMessage(err));
    }
  };

  return (
    <Card title="Preferences">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Theme">
          {(id) => (
            <Select
              id={id}
              value={theme}
              onChange={(e) => {
                setTheme(e.target.value as Theme);
                void change({ theme: e.target.value as Theme });
              }}
            >
              <option value="system">Match system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
          )}
        </Field>
        <Field label="Lock and sign out after inactivity" hint="Locks the vault here, and ends the session on the server.">
          {(id) => (
            <Select id={id} value={preferences.sessionTimeout} onChange={(e) => void change({ sessionTimeout: Number(e.target.value) })}>
              {[5, 15, 30, 60, 240, 480, 0].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'Never' : m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Clear copied passwords after">
          {(id) => (
            <Select id={id} value={preferences.clipboardClear} onChange={(e) => void change({ clipboardClear: Number(e.target.value) })}>
              {[10, 30, 60, 120, 0].map((s) => (
                <option key={s} value={s}>
                  {s === 0 ? 'Never' : `${s} seconds`}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="mt-4">
        <Checkbox label="Compact list" checked={preferences.compactView} onChange={(e) => void change({ compactView: e.target.checked })} />
      </div>
    </Card>
  );
}

function KeyCard() {
  const { user } = useAuth();
  const { isUnlocked, getPrivateKey } = useVault();
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);

  useEffect(() => {
    const key = getPrivateKey();
    if (!key || !user?.publicKey) {
      setFingerprint(null);
      return;
    }
    // Derived from the private key on this device, so it does not rely on
    // what the server says the public key is.
    void publicKeyFromPrivateKey(key).then(async (pub) => {
      setFingerprint(await keyFingerprint(pub));
      setMismatch(pub !== user.publicKey);
    });
  }, [getPrivateKey, user]);

  return (
    <Card title="Your key fingerprint" description="Read this to an admin when they approve you, so they know the key is really yours.">
      {isUnlocked ? (
        <div className="space-y-3">
          <Fingerprint value={fingerprint} />
          {mismatch && (
            <Alert tone="error" title="Public key mismatch">
              The public key stored on the server does not match your private key. Do not let anyone approve you until this is
              resolved, and contact your administrator.
            </Alert>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500">Unlock your vault to see your fingerprint.</p>
      )}
    </Card>
  );
}

function MasterPasswordCard() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user?.encryptedPrivateKey || !user.salt) return null;
  const strength = assessMasterPassword(next);
  const valid = next.length >= MIN_MASTER_PASSWORD_LENGTH && next === confirm && strength.score >= 2;
  const outdated = user.kdfIterations < CURRENT_KDF_ITERATIONS;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user.encryptedPrivateKey || !user.salt) return;
    setBusy(true);
    setError(null);
    try {
      let privateKey: CryptoKey;
      try {
        privateKey = await unwrapPrivateKey(user.encryptedPrivateKey, user.salt, current, user.kdfIterations);
      } catch {
        throw new Error('Your current master password is incorrect');
      }
      const wrapped = await wrapPrivateKey(privateKey, next);
      updateUser(await authApi.changeMasterPassword(wrapped));
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Master password changed', 'Your other sessions were signed out.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Change master password" description="Your keys are re-encrypted on this device. Your access to organizations does not change.">
      <form onSubmit={submit} className="space-y-4">
        {outdated && (
          <Alert tone="warning">
            Your keys use an older, weaker password-hashing setting. Changing your master password (you can reuse the same one) upgrades it.
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Current master password">
          {(id) => <TextInput id={id} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New master password" hint={next ? `${strength.label}${strength.feedback ? `: ${strength.feedback}` : ''}` : `At least ${MIN_MASTER_PASSWORD_LENGTH} characters`}>
            {(id) => <TextInput id={id} type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />}
          </Field>
          <Field label="Confirm new password" error={confirm && confirm !== next ? 'Does not match' : null}>
            {(id) => <TextInput id={id} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          </Field>
        </div>
        <Button type="submit" loading={busy} disabled={!valid || !current}>
          Change master password
        </Button>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const { logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const signOutEverywhere = async () => {
    try {
      const { sessionsRevoked } = await authApi.logoutAll();
      toast.success(`Signed out of ${sessionsRevoked} session${sessionsRevoked === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error('Could not sign out everywhere', errorMessage(err));
      return;
    }
    await logout();
    navigate('/login');
  };

  return (
    <Card title="Sessions" description="Sign out on every device, including this one. Use this if a device is lost.">
      <Button variant="secondary" onClick={() => void signOutEverywhere()}>
        Sign out everywhere
      </Button>
    </Card>
  );
}

export default function UserPreferences() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Preferences and security" />
      <ProfileCard />
      <PreferencesCard />
      <KeyCard />
      <MasterPasswordCard />
      <SessionsCard />
    </div>
  );
}
