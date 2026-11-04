/**
 * Organization settings (admins): policies, name, emergency access, key
 * rotation, and leaving or deleting the organization.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVault } from '../../hooks/useVault';
import { emergencyApi, orgSettingsApi, orgsApi, type EmergencyContact, type EmergencyRequest, type OrgSettings as Settings } from '../../lib/api';
import { encryptOrgKeyFor, keyFingerprint } from '../../lib/crypto';
import { useToast } from '../ui/Toast';
import { Alert, Badge, Button, Card, Checkbox, Field, Fingerprint, Modal, PageHeader, Spinner, TextInput, errorMessage } from '../ui/kit';
import KeyRotationDialog from './KeyRotationDialog';

function PolicyForm() {
  const { currentOrg } = useVault();
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (currentOrg) orgSettingsApi.get(currentOrg.id).then(setSettings).catch(() => undefined);
  }, [currentOrg]);

  if (!settings || !currentOrg) return <Spinner />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v });
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      setSettings(await orgSettingsApi.update(currentOrg.id, settings));
      toast.success('Settings saved');
    } catch (err) {
      toast.error('Could not save settings', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum generated password length" hint="Used by the password generator and form warnings.">
          {(id) => <TextInput id={id} type="number" min={8} max={128} value={settings.minPasswordLength} onChange={num('minPasswordLength')} />}
        </Field>
        <Field label="Default expiry for new logins (days)" hint="0 means new logins do not expire.">
          {(id) => <TextInput id={id} type="number" min={0} max={730} value={settings.passwordExpiryDays} onChange={num('passwordExpiryDays')} />}
        </Field>
        <Field label="Keep audit log for (days)" hint="Older entries are deleted by the daily cleanup.">
          {(id) => <TextInput id={id} type="number" min={30} max={3650} value={settings.auditRetentionDays} onChange={num('auditRetentionDays')} />}
        </Field>
      </div>

      <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
        <Checkbox label="Allow share links" checked={settings.allowShareLinks} onChange={(e) => set('allowShareLinks', e.target.checked)} />
        {settings.allowShareLinks && (
          <Field label="Longest share link (hours)">
            {(id) => <TextInput id={id} type="number" min={1} max={720} value={settings.shareLinkMaxHours} onChange={num('shareLinkMaxHours')} className="max-w-xs" />}
          </Field>
        )}
      </div>

      <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
        <Checkbox label="Allow emergency access" checked={settings.allowEmergencyAccess} onChange={(e) => set('allowEmergencyAccess', e.target.checked)} />
        {settings.allowEmergencyAccess && (
          <Field label="Minimum waiting period for emergency contacts (hours)">
            {(id) => <TextInput id={id} type="number" min={1} max={720} value={settings.emergencyWaitMinHours} onChange={num('emergencyWaitMinHours')} className="max-w-xs" />}
          </Field>
        )}
      </div>

      <Button type="submit" loading={saving}>
        Save settings
      </Button>
    </form>
  );
}

function AddContactDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { currentOrg, getOrgKey } = useVault();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [hours, setHours] = useState(48);
  const [found, setFound] = useState<{ publicKey: string; fingerprint: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentOrg) return;
    setBusy(true);
    setError(null);
    try {
      const user = await emergencyApi.lookupContact(currentOrg.id, email.trim());
      setFound({ publicKey: user.publicKey, fingerprint: await keyFingerprint(user.publicKey) });
      if (!name && user.name) setName(user.name);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const orgKey = getOrgKey();
    if (!currentOrg || !orgKey || !found) return;
    setBusy(true);
    try {
      await emergencyApi.addContact(currentOrg.id, {
        contactEmail: email.trim(),
        contactName: name.trim() || undefined,
        waitTimeHours: hours,
        encryptedOrgKey: await encryptOrgKeyFor(orgKey, found.publicKey),
      });
      toast.success('Emergency contact added');
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add emergency contact"
      onClose={onClose}
      footer={
        found ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!confirmed} loading={busy} onClick={() => void add()}>
              Add contact
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        <p>
          An emergency contact is a trusted person outside the organization (for example a board chair) who can request read-only access
          if the admins become unreachable. Admins are emailed and can deny the request during the waiting period.
        </p>
        {error && <Alert tone="error">{error}</Alert>}
        {!found ? (
          <form onSubmit={lookup} className="space-y-3">
            <Field label="Their CloudVault email" hint="They need an account with a master password already.">
              {(id) => <TextInput id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Button type="submit" loading={busy}>
              Look up
            </Button>
          </form>
        ) : (
          <>
            <Field label="Name (optional)">{(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Waiting period (hours)">
              {(id) => <TextInput id={id} type="number" min={1} max={720} value={hours} onChange={(e) => setHours(Number(e.target.value))} />}
            </Field>
            <p>Ask them to read their key fingerprint from their Preferences page. It must match:</p>
            <div className="text-center">
              <Fingerprint value={found.fingerprint} />
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-vault-600" />
              The fingerprint matches
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}

function EmergencySection() {
  const { currentOrg } = useVault();
  const toast = useToast();
  const [contacts, setContacts] = useState<EmergencyContact[] | null>(null);
  const [requests, setRequests] = useState<EmergencyRequest[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    if (!currentOrg) return;
    emergencyApi.listContacts(currentOrg.id).then(setContacts).catch(() => setContacts([]));
    emergencyApi.listRequests(currentOrg.id).then(setRequests).catch(() => setRequests([]));
  }, [currentOrg]);
  useEffect(load, [load]);

  if (!currentOrg) return null;

  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast.success(message);
      load();
    } catch (err) {
      toast.error('Action failed', errorMessage(err));
    }
  };

  const open = requests.filter((r) => r.canRespond);

  return (
    <div className="space-y-4">
      {open.map((r) => (
        <Alert key={r.id} tone="warning" title={`${r.contactName || r.contactEmail} requested emergency access`}>
          <p>Reason: {r.reason}</p>
          <p>
            {r.status === 'approved' ? 'Approved; they can claim access now.' : `Access will be granted automatically on ${new Date(r.grantAt.replace(' ', 'T') + 'Z').toLocaleString()}.`}
          </p>
          <div className="mt-2 flex gap-2">
            {r.status === 'pending' && (
              <Button size="sm" variant="secondary" onClick={() => void act(() => emergencyApi.approveRequest(currentOrg.id, r.id), 'Request approved')}>
                Approve now
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={() => void act(() => emergencyApi.denyRequest(currentOrg.id, r.id), 'Request denied')}>
              Deny
            </Button>
          </div>
        </Alert>
      ))}

      {contacts === null ? (
        <Spinner />
      ) : contacts.length === 0 ? (
        <p className="text-sm text-gray-500">No emergency contacts.</p>
      ) : (
        <ul className="divide-y divide-gray-200 text-sm dark:divide-gray-700">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-white">{c.contactName || c.contactEmail}</p>
                <p className="text-xs text-gray-500">
                  {c.contactEmail}, {c.waitTimeHours}h wait
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void act(() => emergencyApi.removeContact(currentOrg.id, c.id), 'Contact removed')}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" onClick={() => setAdding(true)}>
        Add emergency contact
      </Button>

      {requests.some((r) => !r.canRespond) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500">Past requests</summary>
          <ul className="mt-2 space-y-1">
            {requests
              .filter((r) => !r.canRespond)
              .map((r) => (
                <li key={r.id} className="text-gray-600 dark:text-gray-400">
                  {new Date(r.requestedAt.replace(' ', 'T') + 'Z').toLocaleDateString()}: {r.contactEmail} <Badge>{r.status}</Badge>
                  {r.resolvedByEmail && ` by ${r.resolvedByEmail}`}
                </li>
              ))}
          </ul>
        </details>
      )}

      {adding && (
        <AddContactDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </div>
  );
}

export default function OrgSettings() {
  const { currentOrg, loadOrganizations } = useVault();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(currentOrg?.name ?? '');
  const [showRotation, setShowRotation] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setName(currentOrg?.name ?? ''), [currentOrg]);
  if (!currentOrg) return null;

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await orgsApi.rename(currentOrg.id, name.trim());
      await loadOrganizations();
      toast.success('Organization renamed');
    } catch (err) {
      toast.error('Could not rename', errorMessage(err));
    }
  };

  const leave = async () => {
    try {
      await orgsApi.leave(currentOrg.id);
      toast.success(`You left ${currentOrg.name}`);
      await loadOrganizations();
      navigate('/');
    } catch (err) {
      toast.error('Could not leave', errorMessage(err));
    }
  };

  const destroy = async () => {
    setBusy(true);
    try {
      await orgsApi.delete(currentOrg.id);
      toast.success(`${currentOrg.name} was deleted`);
      setDeleting(false);
      await loadOrganizations();
      navigate('/');
    } catch (err) {
      toast.error('Could not delete', errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description={`Policies and administration for ${currentOrg.name}`} />

      <Card title="Organization name">
        <form onSubmit={rename} className="flex gap-2">
          <TextInput aria-label="Organization name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={!name.trim() || name.trim() === currentOrg.name}>
            Rename
          </Button>
        </form>
      </Card>

      <Card title="Policies">
        <PolicyForm />
      </Card>

      <Card title="Emergency access" description="Break-glass access for a trusted person if every admin is unreachable.">
        <EmergencySection />
      </Card>

      <Card title="Vault key" description="Re-encrypt everything with a new key. Do this after removing someone, or if you think the key was exposed.">
        <Button variant="secondary" onClick={() => setShowRotation(true)}>
          Rotate vault key
        </Button>
      </Card>

      <Card title="Leave or delete">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void leave()}>
            Leave organization
          </Button>
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Delete organization
          </Button>
        </div>
      </Card>

      {showRotation && <KeyRotationDialog onClose={() => setShowRotation(false)} />}
      {deleting && (
        <Modal
          title={`Delete ${currentOrg.name}?`}
          onClose={() => setDeleting(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(false)}>
                Cancel
              </Button>
              <Button variant="danger" loading={busy} disabled={confirmName !== currentOrg.name} onClick={() => void destroy()}>
                Delete forever
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <p>This permanently deletes every item, its history, categories, share links and memberships. Export first if you need a backup.</p>
            <Field label={`Type "${currentOrg.name}" to confirm`}>{(id) => <TextInput id={id} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />}</Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
