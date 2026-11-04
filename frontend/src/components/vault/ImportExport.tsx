/**
 * Import from other password managers or a CloudVault backup, and export
 * (encrypted backup or plain CSV). All parsing, encryption and decryption
 * happens in the browser.
 */

import { useState } from 'react';
import { useVault } from '../../hooks/useVault';
import { secretsApi } from '../../lib/api';
import { decryptSecretPayload } from '../../lib/crypto';
import {
  createEncryptedBackup,
  isEncryptedBackup,
  parseImport,
  readEncryptedBackup,
  toBitwardenCsv,
  type ImportFormat,
  type ImportItem,
} from '../../lib/importers';
import { useToast } from '../ui/Toast';
import { Alert, Button, Card, Checkbox, Field, PageHeader, Select, TextInput, errorMessage } from '../ui/kit';

/** Items per import request (the server accepts up to 500). */
const BATCH_SIZE = 200;

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ImportCard() {
  const { currentOrg, encryptForImport, refreshSecrets } = useVault();
  const toast = useToast();
  const [format, setFormat] = useState<ImportFormat>('bitwarden_csv');
  const [fileText, setFileText] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    setItems(null);
    setError(null);
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('That file is larger than 10 MB');
      return;
    }
    const text = await file.text();
    setFileText(text);
    if (isEncryptedBackup(text)) {
      setFormat('cloudvault_backup');
      return;
    }
    if (format === 'cloudvault_backup') return setError('That is not a CloudVault backup file');
    try {
      setItems(parseImport(text, format));
    } catch (err) {
      setError(errorMessage(err, 'Could not read the file'));
    }
  };

  const unlockBackup = async () => {
    if (!fileText) return;
    setError(null);
    try {
      setItems(await readEncryptedBackup(fileText, passphrase));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const runImport = async () => {
    if (!currentOrg || !items) return;
    setError(null);
    let done = 0;
    try {
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        setProgress(`Encrypting and uploading ${Math.min(i + BATCH_SIZE, items.length)} of ${items.length}...`);
        await secretsApi.import(currentOrg.id, await encryptForImport(batch));
        done += batch.length;
      }
      toast.success(`Imported ${done} items`);
      setItems(null);
      setFileText(null);
      await refreshSecrets();
    } catch (err) {
      setError(`${errorMessage(err, 'Import failed')}. ${done} of ${items.length} items were imported before the error.`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Card title="Import" description="Bring passwords in from another password manager or a CloudVault backup.">
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Format">
            {(id) => (
              <Select id={id} value={format} onChange={(e) => setFormat(e.target.value as ImportFormat)}>
                <option value="bitwarden_csv">Bitwarden (CSV)</option>
                <option value="lastpass_csv">LastPass (CSV)</option>
                <option value="generic_csv">Other CSV (name, url, username, password, notes)</option>
                <option value="cloudvault_backup">CloudVault encrypted backup</option>
              </Select>
            )}
          </Field>
          <Field label="File">
            {(id) => <TextInput id={id} type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => void onFile(e.target.files?.[0])} />}
          </Field>
        </div>

        {format === 'cloudvault_backup' && fileText && !items && (
          <div className="flex items-end gap-2">
            <Field label="Backup passphrase">
              {(id) => <TextInput id={id} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />}
            </Field>
            <Button onClick={() => void unlockBackup()}>Open backup</Button>
          </div>
        )}

        {items && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Found <strong>{items.length}</strong> items. Preview of the first {Math.min(items.length, 10)}:
            </p>
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 text-sm dark:divide-gray-700 dark:border-gray-700">
              {items.slice(0, 10).map((item, i) => (
                <li key={i} className="flex gap-3 px-3 py-2">
                  <span className="flex-1 truncate font-medium text-gray-900 dark:text-white">{item.name}</span>
                  <span className="truncate text-gray-500">{item.usernameHint}</span>
                </li>
              ))}
            </ul>
            <Button loading={!!progress} onClick={() => void runImport()}>
              Import {items.length} items into {currentOrg?.name}
            </Button>
            {progress && <p className="text-sm text-gray-500">{progress}</p>}
          </div>
        )}
        <p className="text-xs text-gray-500">After importing, delete the export file from your computer: it contains your passwords in plain text.</p>
      </div>
    </Card>
  );
}

function ExportCard() {
  const { currentOrg, getOrgKey } = useVault();
  const toast = useToast();
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [plainAck, setPlainAck] = useState(false);
  const [busy, setBusy] = useState<'backup' | 'csv' | null>(null);

  const collect = async (): Promise<ImportItem[]> => {
    if (!currentOrg) return [];
    const { secrets } = await secretsApi.export(currentOrg.id);
    const key = getOrgKey();
    if (!key) throw new Error('Vault is locked');
    return Promise.all(
      secrets.map(async (s) => ({
        name: s.name,
        url: s.url ?? undefined,
        usernameHint: s.usernameHint ?? undefined,
        secretType: s.secretType,
        tags: s.categoryName ? [s.categoryName, ...s.tags] : s.tags,
        expiresAt: s.expiresAt,
        payload: await decryptSecretPayload(s, key, currentOrg.id, s.id),
      }))
    );
  };

  const exportBackup = async () => {
    setBusy('backup');
    try {
      const items = await collect();
      download(`cloudvault-${currentOrg?.name ?? 'vault'}-${new Date().toISOString().slice(0, 10)}.json`, await createEncryptedBackup(items, passphrase), 'application/json');
      toast.success(`Exported ${items.length} items`);
      setPassphrase('');
      setConfirm('');
    } catch (err) {
      toast.error('Export failed', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    setBusy('csv');
    try {
      const items = await collect();
      download(`cloudvault-${currentOrg?.name ?? 'vault'}-UNENCRYPTED.csv`, toBitwardenCsv(items), 'text/csv');
      toast.success(`Exported ${items.length} items`);
    } catch (err) {
      toast.error('Export failed', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Export" description="Every export is recorded in the audit log.">
      <div className="space-y-6">
        <div className="space-y-3">
          <h3 className="font-medium text-gray-900 dark:text-white">Encrypted backup (recommended)</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            A file protected by a passphrase you choose. It can be restored into any CloudVault organization, even after a key rotation.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Backup passphrase" hint="At least 12 characters. Without it the backup cannot be opened.">
              {(id) => <TextInput id={id} type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />}
            </Field>
            <Field label="Confirm passphrase" error={confirm && confirm !== passphrase ? 'Does not match' : null}>
              {(id) => <TextInput id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
            </Field>
          </div>
          <Button loading={busy === 'backup'} disabled={passphrase.length < 12 || passphrase !== confirm} onClick={() => void exportBackup()}>
            Download encrypted backup
          </Button>
        </div>

        <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <h3 className="font-medium text-gray-900 dark:text-white">Unencrypted CSV</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">For moving to another password manager. Uses the Bitwarden CSV layout, which most managers can import.</p>
          <Checkbox label="I understand this file contains every password in plain text" checked={plainAck} onChange={(e) => setPlainAck(e.target.checked)} />
          <Button variant="danger" disabled={!plainAck} loading={busy === 'csv'} onClick={() => void exportCsv()}>
            Download unencrypted CSV
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function ImportExport() {
  const { currentOrg } = useVault();
  const canWrite = currentOrg?.role !== 'read_only';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Import and export" description={currentOrg?.name} />
      {canWrite ? <ImportCard /> : <Alert tone="info">Read-only members cannot import.</Alert>}
      <ExportCard />
    </div>
  );
}
