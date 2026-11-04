/**
 * Secret detail view: decrypted fields with reveal and copy, TOTP codes,
 * version history (decrypted locally, with restore) and share links.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVault, type OpenedSecret } from '../../hooks/useVault';
import { useClipboard } from '../../hooks/useClipboard';
import { secretsApi, sharingApi, type SecretHistory, type ShareLink } from '../../lib/api';
import type { SecretPayload } from '../../lib/crypto';
import { useToast } from '../ui/Toast';
import { Alert, Badge, Button, Modal, Spinner, cx, errorMessage } from '../ui/kit';
import TOTPDisplay from './TOTPDisplay';
import ShareModal from './ShareModal';
import { SECRET_TYPE_LABELS, expiryBadge } from './SecretList';

function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function FieldRow({ label, value, secret = false, mono = false, copyKey }: { label: string; value?: string; secret?: boolean; mono?: boolean; copyKey: string }) {
  const [revealed, setRevealed] = useState(false);
  const { copy, copiedKey } = useClipboard();
  if (!value) return null;
  const shown = secret && !revealed ? '•'.repeat(Math.min(value.length, 16)) : value;
  return (
    <div className="py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-1 flex items-start gap-2">
        <span className={cx('min-w-0 flex-1 break-all text-sm text-gray-900 dark:text-gray-100', (mono || secret) && 'font-mono')}>{shown}</span>
        {secret && (
          <Button variant="ghost" size="sm" onClick={() => setRevealed((r) => !r)} aria-label={revealed ? `Hide ${label}` : `Show ${label}`}>
            {revealed ? 'Hide' : 'Show'}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => void copy(value, copyKey)} aria-label={`Copy ${label}`}>
          {copiedKey === copyKey ? 'Copied' : 'Copy'}
        </Button>
      </dd>
    </div>
  );
}

export function PayloadFields({ payload, prefix = '' }: { payload: SecretPayload; prefix?: string }) {
  return (
    <dl className="divide-y divide-gray-100 dark:divide-gray-700">
      <FieldRow label="Username" value={payload.username} copyKey={`${prefix}username`} />
      <FieldRow label="Password" value={payload.password} secret copyKey={`${prefix}password`} />
      <FieldRow label="API key" value={payload.apiKey} secret copyKey={`${prefix}apikey`} />
      {payload.card && (
        <>
          <FieldRow label="Cardholder" value={payload.card.holder} copyKey={`${prefix}holder`} />
          <FieldRow label="Card number" value={payload.card.number} secret mono copyKey={`${prefix}number`} />
          <FieldRow label="Expiry" value={payload.card.expiry} copyKey={`${prefix}expiry`} />
          <FieldRow label="Security code" value={payload.card.cvv} secret copyKey={`${prefix}cvv`} />
          <FieldRow label="PIN" value={payload.card.pin} secret copyKey={`${prefix}pin`} />
        </>
      )}
      {payload.customFields?.map((f, i) => (
        <FieldRow key={i} label={f.label} value={f.value} secret={f.hidden} copyKey={`${prefix}custom${i}`} />
      ))}
      {payload.notes && (
        <div className="py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Notes</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-900 dark:text-gray-100">{payload.notes}</dd>
        </div>
      )}
    </dl>
  );
}

type Tab = 'details' | 'history' | 'sharing';

export default function SecretView({ secretId, onClose }: { secretId: string; onClose: () => void }) {
  const { currentOrg, openSecret, decryptRecord, deleteSecret, updateSecret } = useVault();
  const navigate = useNavigate();
  const toast = useToast();

  const [opened, setOpened] = useState<OpenedSecret | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('details');
  const [history, setHistory] = useState<Array<SecretHistory & { payload: SecretPayload | null }> | null>(null);
  const [shares, setShares] = useState<ShareLink[] | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    openSecret(secretId)
      .then(setOpened)
      .catch((err) => setError(errorMessage(err, 'Could not decrypt this item')));
  }, [openSecret, secretId]);
  useEffect(load, [load]);

  const loadHistory = useCallback(async () => {
    if (!currentOrg) return;
    try {
      const entries = await secretsApi.getHistory(currentOrg.id, secretId);
      const decrypted = await Promise.all(
        entries.map(async (h) => ({ ...h, payload: await decryptRecord(secretId, h).catch(() => null) }))
      );
      setHistory(decrypted);
    } catch (err) {
      toast.error('Could not load history', errorMessage(err));
      setHistory([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrg, secretId, decryptRecord]);

  const loadShares = useCallback(async () => {
    if (!currentOrg) return;
    setShares(await sharingApi.list(currentOrg.id, secretId).catch(() => []));
  }, [currentOrg, secretId]);

  useEffect(() => {
    if (tab === 'history' && history === null) void loadHistory();
    if (tab === 'sharing' && shares === null) void loadShares();
  }, [tab, history, shares, loadHistory, loadShares]);

  const canWrite = currentOrg?.role !== 'read_only';

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteSecret(secretId);
      toast.success('Item deleted');
      onClose();
    } catch (err) {
      toast.error('Could not delete', errorMessage(err));
      setBusy(false);
    }
  };

  const handleRestore = async (entry: SecretHistory & { payload: SecretPayload | null }) => {
    if (!entry.payload || !opened) return;
    setBusy(true);
    try {
      await updateSecret(secretId, {}, entry.payload, opened.secret.version);
      toast.success(`Restored version ${entry.version}`);
      setHistory(null);
      setTab('details');
      load();
    } catch (err) {
      toast.error('Could not restore', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (linkId: string) => {
    if (!currentOrg) return;
    try {
      await sharingApi.revoke(currentOrg.id, linkId);
      toast.success('Share link revoked');
      void loadShares();
    } catch (err) {
      toast.error('Could not revoke', errorMessage(err));
    }
  };

  const secret = opened?.secret;
  const payload = opened?.payload;
  const href = safeHref(secret?.url ?? null);

  return (
    <>
      <Modal
        title={secret?.name ?? 'Loading...'}
        onClose={onClose}
        size="lg"
        footer={
          secret &&
          canWrite && (
            <>
              {confirmDelete ? (
                <>
                  <span className="mr-auto self-center text-sm text-red-600 dark:text-red-400">Delete this item and its history?</span>
                  <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                  <Button variant="danger" loading={busy} onClick={() => void handleDelete()}>
                    Delete
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" className="mr-auto text-red-600 dark:text-red-400" onClick={() => setConfirmDelete(true)}>
                    Delete
                  </Button>
                  <Button variant="secondary" onClick={() => setShowShare(true)}>
                    Share
                  </Button>
                  <Button onClick={() => navigate(`/secrets/${secretId}/edit`)}>Edit</Button>
                </>
              )}
            </>
          )
        }
      >
        {error && <Alert tone="error">{error}</Alert>}
        {!error && !opened && (
          <div className="flex justify-center py-10 text-vault-600">
            <Spinner className="h-8 w-8" />
          </div>
        )}

        {secret && payload && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge color="blue">{SECRET_TYPE_LABELS[secret.secretType]}</Badge>
              {secret.categoryName && <Badge>{secret.categoryName}</Badge>}
              {secret.tags.map((t) => (
                <Badge key={t} color="purple">
                  {t}
                </Badge>
              ))}
              {expiryBadge(secret.expiresAt)}
            </div>

            <div className="flex gap-4 border-b border-gray-200 text-sm dark:border-gray-700" role="tablist">
              {(['details', 'history', 'sharing'] as Tab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cx(
                    '-mb-px border-b-2 px-1 pb-2 font-medium capitalize',
                    tab === t ? 'border-vault-600 text-vault-700 dark:text-vault-300' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === 'details' && (
              <div className="space-y-3">
                {href && (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="block truncate text-sm text-vault-600 hover:underline">
                    {secret.url}
                  </a>
                )}
                {payload.totp && <TOTPDisplay value={payload.totp} />}
                <PayloadFields payload={payload} />
                <p className="text-xs text-gray-400">
                  Version {secret.version}, updated {new Date(secret.updatedAt.replace(' ', 'T') + (secret.updatedAt.endsWith('Z') ? '' : 'Z')).toLocaleString()}
                </p>
              </div>
            )}

            {tab === 'history' && (
              <div>
                {history === null ? (
                  <Spinner />
                ) : history.length === 0 ? (
                  <p className="text-sm text-gray-500">No earlier versions. The last 20 versions are kept when the contents change.</p>
                ) : (
                  <ul className="space-y-3">
                    {history.map((h) => (
                      <li key={h.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="font-medium text-gray-900 dark:text-white">Version {h.version}</span>
                          <span className="text-xs text-gray-500">
                            {h.changedByEmail ?? 'unknown'} replaced it on {new Date(h.createdAt.replace(' ', 'T') + 'Z').toLocaleString()}
                          </span>
                        </div>
                        {h.payload ? <PayloadFields payload={h.payload} prefix={`h${h.id}`} /> : <Alert tone="warning">This version could not be decrypted.</Alert>}
                        {canWrite && h.payload && (
                          <Button variant="secondary" size="sm" className="mt-2" loading={busy} onClick={() => void handleRestore(h)}>
                            Restore this version
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {tab === 'sharing' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Share links give someone outside the vault temporary access to a copy of this item. The decryption key is part of
                  the link and is never sent to the server.
                </p>
                {shares === null ? (
                  <Spinner />
                ) : shares.length === 0 ? (
                  <p className="text-sm text-gray-500">No share links.</p>
                ) : (
                  <ul className="divide-y divide-gray-200 text-sm dark:divide-gray-700">
                    {shares.map((l) => {
                      const active = !l.isRevoked && !l.isExpired && !l.isExhausted;
                      return (
                        <li key={l.id} className="flex items-center gap-3 py-2">
                          <div className="flex-1">
                            <p className="text-gray-900 dark:text-gray-100">
                              {l.recipientEmail ?? 'Anyone with the link'} {l.hasPassword && <Badge>password</Badge>}
                            </p>
                            <p className="text-xs text-gray-500">
                              Viewed {l.viewCount}
                              {l.maxViews > 0 ? ` of ${l.maxViews}` : ''} times, {active ? `expires ${new Date(l.expiresAt).toLocaleString()}` : l.isRevoked ? 'revoked' : l.isExpired ? 'expired' : 'used up'}
                            </p>
                          </div>
                          {active && canWrite && (
                            <Button variant="secondary" size="sm" onClick={() => void handleRevoke(l.id)}>
                              Revoke
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {showShare && secret && payload && currentOrg && (
        <ShareModal
          orgId={currentOrg.id}
          secretId={secret.id}
          secretName={secret.name}
          payload={payload}
          onClose={() => {
            setShowShare(false);
            setShares(null);
          }}
        />
      )}
    </>
  );
}
