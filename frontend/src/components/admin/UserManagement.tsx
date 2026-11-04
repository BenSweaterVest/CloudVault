/**
 * Members: invite, approve (with key fingerprint verification), change
 * roles, remove, and rotate the org key after a removal.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../lib/auth';
import { useVault } from '../../hooks/useVault';
import { orgsApi, type Membership, type Role } from '../../lib/api';
import { encryptOrgKeyFor, keyFingerprint } from '../../lib/crypto';
import { useToast } from '../ui/Toast';
import { Alert, Badge, Button, Card, Field, Fingerprint, Modal, PageHeader, Select, Spinner, TextInput, errorMessage } from '../ui/kit';
import KeyRotationDialog from './KeyRotationDialog';

const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', member: 'Member', read_only: 'Read-only' };

function ApproveDialog({ member, onClose, onApproved }: { member: Membership; onClose: () => void; onApproved: () => void }) {
  const { currentOrg, getOrgKey } = useVault();
  const toast = useToast();
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (member.userPublicKey) void keyFingerprint(member.userPublicKey).then(setFingerprint);
  }, [member.userPublicKey]);

  const approve = async () => {
    const orgKey = getOrgKey();
    if (!currentOrg || !orgKey || !member.userPublicKey) return;
    setBusy(true);
    try {
      const encryptedOrgKey = await encryptOrgKeyFor(orgKey, member.userPublicKey);
      await orgsApi.approveUser(currentOrg.id, member.userId, encryptedOrgKey);
      toast.success(`${member.userEmail} approved`);
      onApproved();
    } catch (err) {
      toast.error('Could not approve', errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Approve ${member.userEmail}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!confirmed} loading={busy} onClick={() => void approve()}>
            Approve
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        <p>Approving gives this person a copy of the vault key, encrypted for their public key. Check that the key really is theirs first.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Contact them in a way you trust (phone, video call or in person), not by email.</li>
          <li>Ask them to read the fingerprint from their Preferences page.</li>
          <li>Approve only if it matches this one exactly:</li>
        </ol>
        <div className="text-center">
          <Fingerprint value={fingerprint} />
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-vault-600" />
          The fingerprint they read to me matches
        </label>
        <Alert tone="info">This check stops a compromised server from slipping in its own key to receive the vault key.</Alert>
      </div>
    </Modal>
  );
}

export default function UserManagement() {
  const { user } = useAuth();
  const { currentOrg } = useVault();
  const toast = useToast();
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [inviting, setInviting] = useState(false);
  const [approving, setApproving] = useState<Membership | null>(null);
  const [removing, setRemoving] = useState<Membership | null>(null);
  const [showRotation, setShowRotation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!currentOrg) return;
    orgsApi
      .getMembers(currentOrg.id)
      .then(setMembers)
      .catch((err) => setError(errorMessage(err, 'Could not load members')));
  }, [currentOrg]);
  useEffect(load, [load]);

  if (!currentOrg) return null;

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setInviting(true);
    try {
      const result = await orgsApi.inviteUser(currentOrg.id, email.trim(), role);
      toast.success(
        'Invitation created',
        result.invitationEmailed
          ? `We emailed ${result.userEmail}. Approve them here once they have set up their master password.`
          : `Ask ${result.userEmail} to sign in to CloudVault and set up their master password, then approve them here.`
      );
      setEmail('');
      load();
    } catch (err) {
      toast.error('Could not invite', errorMessage(err));
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (m: Membership, next: Role) => {
    try {
      await orgsApi.updateRole(currentOrg.id, m.userId, next);
      toast.success(`${m.userEmail} is now ${ROLE_LABELS[next].toLowerCase()}`);
      load();
    } catch (err) {
      toast.error('Could not change role', errorMessage(err));
    }
  };

  const remove = async (m: Membership) => {
    try {
      const result = await orgsApi.removeUser(currentOrg.id, m.userId);
      setRemoving(null);
      load();
      if (result.recommendKeyRotation) setShowRotation(true);
      else toast.success('Invitation cancelled');
    } catch (err) {
      toast.error('Could not remove', errorMessage(err));
    }
  };

  const pending = members?.filter((m) => m.status === 'pending') ?? [];
  const active = members?.filter((m) => m.status === 'active') ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Members" description={`People who can access ${currentOrg.name}`} />
      {error && <Alert tone="error">{error}</Alert>}

      <Card title="Invite someone">
        <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field label="Email address">{(id) => <TextInput id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Role">
            {(id) => (
              <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">Member (view and edit)</option>
                <option value="read_only">Read-only</option>
                <option value="admin">Admin</option>
              </Select>
            )}
          </Field>
          <Button type="submit" loading={inviting}>
            Invite
          </Button>
        </form>
      </Card>

      {members === null ? (
        <Spinner />
      ) : (
        <>
          {pending.length > 0 && (
            <Card title="Waiting for approval" description="They can only be approved after they sign in and create their master password.">
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {pending.map((m) => (
                  <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">{m.userEmail}</p>
                      <p className="text-xs text-gray-500">
                        Invited as {ROLE_LABELS[m.role].toLowerCase()}. {m.hasKeys ? 'Ready to approve.' : 'Has not set up a master password yet.'}
                      </p>
                    </div>
                    <Button size="sm" disabled={!m.hasKeys} onClick={() => setApproving(m)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void remove(m)}>
                      Cancel invite
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={`Members (${active.length})`}>
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {active.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900 dark:text-white">
                      {m.userName || m.userEmail} {m.userId === user?.id && <Badge color="blue">you</Badge>}
                    </p>
                    {m.userName && <p className="truncate text-xs text-gray-500">{m.userEmail}</p>}
                  </div>
                  {m.userId === user?.id ? (
                    <Badge>{ROLE_LABELS[m.role]}</Badge>
                  ) : (
                    <>
                      <Select aria-label={`Role for ${m.userEmail}`} value={m.role} onChange={(e) => void changeRole(m, e.target.value as Role)} className="w-36">
                        {Object.entries(ROLE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="secondary" onClick={() => setRemoving(m)}>
                        Remove
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {approving && (
        <ApproveDialog
          member={approving}
          onClose={() => setApproving(null)}
          onApproved={() => {
            setApproving(null);
            load();
          }}
        />
      )}

      {removing && (
        <Modal
          title={`Remove ${removing.userEmail}?`}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void remove(removing)}>
                Remove
              </Button>
            </>
          }
        >
          <p className="text-sm text-gray-700 dark:text-gray-300">
            They lose access immediately. Anything they already viewed, and the vault key itself if they kept a copy, cannot be taken
            back. You will be offered a key rotation next, and you should change any passwords they used.
          </p>
        </Modal>
      )}

      {showRotation && <KeyRotationDialog reason="removed" onClose={() => setShowRotation(false)} />}
    </div>
  );
}
