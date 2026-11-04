/**
 * Create a share link. The secret is re-encrypted in the browser with a new
 * one-off key that lives only in the link's #fragment.
 */

import { useState } from 'react';
import { sharingApi, type ShareLink } from '../../lib/api';
import { createShareAccessVerifier, createSharePackage, type SecretPayload } from '../../lib/crypto';
import { useClipboard } from '../../hooks/useClipboard';
import { Alert, Button, Checkbox, Field, Modal, Select, TextInput, errorMessage } from '../ui/kit';

interface ShareModalProps {
  orgId: string;
  secretId: string;
  secretName: string;
  payload: SecretPayload;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { value: 1, label: '1 hour' },
  { value: 4, label: '4 hours' },
  { value: 24, label: '1 day' },
  { value: 72, label: '3 days' },
  { value: 168, label: '1 week' },
];

const VIEW_OPTIONS = [
  { value: 1, label: '1 view' },
  { value: 3, label: '3 views' },
  { value: 10, label: '10 views' },
  { value: 0, label: 'Unlimited until expiry' },
];

export default function ShareModal({ orgId, secretId, secretName, payload, onClose }: ShareModalProps) {
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [maxViews, setMaxViews] = useState(1);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [allowCopy, setAllowCopy] = useState(true);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<(ShareLink & { fullUrl: string }) | null>(null);
  // Never clear the clipboard for a share link: the user is about to paste it.
  const { copy, copiedKey } = useClipboard({ clearAfterSeconds: 0 });

  const handleCreate = async () => {
    if (usePassword && password.length < 6) {
      setError('Use a password of at least 6 characters');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const linkId = crypto.randomUUID();
      // Share only what the recipient needs: drop history-related or org data.
      const pkg = await createSharePackage(payload, linkId);
      const gate = usePassword ? await createShareAccessVerifier(password) : {};
      const link = await sharingApi.create(orgId, secretId, {
        id: linkId,
        ciphertextBlob: pkg.ciphertextBlob,
        iv: pkg.iv,
        expiresInHours,
        maxViews,
        allowCopy,
        recipientEmail: recipientEmail.trim() || undefined,
        ...gate,
      });
      setCreated({ ...link, fullUrl: `${link.url}#${pkg.fragmentKey}` });
    } catch (err) {
      setError(errorMessage(err, 'Could not create the share link'));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Modal title="Share link created" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Send this link to the recipient. Anyone with the full link can open it{created.hasPassword ? ' if they also know the password' : ''}.
          </p>
          <div className="flex gap-2">
            <TextInput readOnly value={created.fullUrl} aria-label="Share link" onFocus={(e) => e.target.select()} className="font-mono text-xs" />
            <Button variant="secondary" onClick={() => void copy(created.fullUrl, 'link')}>
              {copiedKey === 'link' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Alert tone="warning">
            This is the only time the complete link is shown. The part after # is the decryption key, and CloudVault does not
            keep it. {created.hasPassword && 'Send the password through a different channel than the link.'}
          </Alert>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Share "${secretName}"`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void handleCreate()}>
            Create link
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expires after">
            {(id) => (
              <Select id={id} value={expiresInHours} onChange={(e) => setExpiresInHours(Number(e.target.value))}>
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Can be opened">
            {(id) => (
              <Select id={id} value={maxViews} onChange={(e) => setMaxViews(Number(e.target.value))}>
                {VIEW_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Recipient email (optional)" hint="For your records in the audit log. The link is not emailed.">
          {(id) => <TextInput id={id} type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />}
        </Field>
        <Checkbox label="Require a password" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
        {usePassword && (
          <Field label="Link password">
            {(id) => <TextInput id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
        )}
        <Checkbox
          label="Show copy buttons to the recipient"
          description="A convenience setting only: anyone who can see a value can also copy it."
          checked={allowCopy}
          onChange={(e) => setAllowCopy(e.target.checked)}
        />
      </div>
    </Modal>
  );
}
