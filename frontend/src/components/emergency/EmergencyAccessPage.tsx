/**
 * For people who are someone's emergency contact: request access, follow the
 * waiting period, and claim access when it is granted.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { emergencyApi, type EmergencyAccessEntry } from '../../lib/api';
import { useVault } from '../../hooks/useVault';
import { useToast } from '../ui/Toast';
import { Alert, Badge, Button, Card, Field, PageHeader, Spinner, TextArea, errorMessage } from '../ui/kit';

function parseUtc(value: string): Date {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function Entry({ entry, onChanged }: { entry: EmergencyAccessEntry; onChanged: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { isUnlocked, loadOrganizations } = useVault();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const request = entry.request;
  const open = request && (request.status === 'pending' || request.status === 'approved');
  const grantAt = request ? parseUtc(request.grantAt) : null;
  const claimable = open && (request.status === 'approved' || (grantAt !== null && grantAt.getTime() <= Date.now()));

  const submit = async () => {
    setBusy(true);
    try {
      await emergencyApi.requestAccess(entry.contactId, reason.trim());
      toast.success('Request sent', 'The admins have been notified.');
      setReason('');
      onChanged();
    } catch (err) {
      toast.error('Could not send request', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const claim = async () => {
    if (!request) return;
    setBusy(true);
    try {
      await emergencyApi.claimAccess(request.id);
      toast.success(`You now have read-only access to ${entry.orgName}`);
      if (isUnlocked) await loadOrganizations();
      navigate('/');
    } catch (err) {
      toast.error('Could not claim access', errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card title={entry.orgName} description={`Waiting period: ${entry.waitTimeHours} hours`}>
      {request && (
        <p className="mb-3 text-sm">
          Latest request: <Badge color={request.status === 'denied' ? 'red' : request.status === 'granted' ? 'green' : 'amber'}>{request.status}</Badge>{' '}
          {open && !claimable && grantAt && <>Access opens {grantAt.toLocaleString()} unless an admin denies it.</>}
        </p>
      )}
      {claimable ? (
        <Button loading={busy} onClick={() => void claim()}>
          Claim read-only access
        </Button>
      ) : open ? null : (
        <div className="space-y-3">
          <Field label="Why do you need access?" hint="The admins see this in the notification email and in CloudVault.">
            {(id) => <TextArea id={id} rows={3} minLength={10} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <Button variant="danger" disabled={reason.trim().length < 10} loading={busy} onClick={() => void submit()}>
            Request emergency access
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function EmergencyAccessPage() {
  const [entries, setEntries] = useState<EmergencyAccessEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    emergencyApi
      .myAccess()
      .then(setEntries)
      .catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Emergency access"
        description="Organizations that named you as their emergency contact. Use this only if their admins cannot be reached."
      />
      {error && <Alert tone="error">{error}</Alert>}
      {entries === null && !error && <Spinner />}
      {entries?.length === 0 && <p className="text-sm text-gray-500">You are not an emergency contact for any organization.</p>}
      {entries?.map((e) => <Entry key={e.contactId} entry={e} onChanged={load} />)}
    </div>
  );
}
