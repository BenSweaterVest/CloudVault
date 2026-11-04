/**
 * Confirm and run an org key rotation, with progress.
 */

import { useState } from 'react';
import { useVault } from '../../hooks/useVault';
import { rotateOrgKey, type RotationProgress } from '../../lib/rotation';
import { useToast } from '../ui/Toast';
import { Alert, Button, Modal, errorMessage } from '../ui/kit';

export default function KeyRotationDialog({ onClose, reason }: { onClose: () => void; reason?: 'removed' }) {
  const { currentOrg, getOrgKey, reloadOrgKeys } = useVault();
  const toast = useToast();
  const [progress, setProgress] = useState<RotationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = progress !== null && progress.stage !== 'done';

  const run = async () => {
    const oldKey = getOrgKey();
    if (!currentOrg || !oldKey) return;
    setError(null);
    try {
      await rotateOrgKey(currentOrg.id, oldKey, setProgress);
      await reloadOrgKeys();
      toast.success('Vault key rotated', 'Every item is now encrypted with a new key.');
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Rotation failed. Nothing was changed.'));
      setProgress(null);
    }
  };

  const label =
    progress?.stage === 'downloading'
      ? 'Downloading encrypted items...'
      : progress?.stage === 'reencrypting'
        ? `Re-encrypting ${progress.done} of ${progress.total}...`
        : progress?.stage === 'uploading'
          ? 'Saving...'
          : null;

  return (
    <Modal
      title="Rotate the vault key"
      onClose={running ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={running} onClick={onClose}>
            {reason === 'removed' ? 'Not now' : 'Cancel'}
          </Button>
          <Button loading={running} onClick={() => void run()}>
            Rotate key
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
        {reason === 'removed' && <Alert tone="success">Member removed.</Alert>}
        <p>
          Rotating creates a new vault key and re-encrypts every item and its history with it, here in your browser. Remaining members and
          emergency contacts receive the new key automatically. Anyone holding only the old key can no longer decrypt anything new or changed.
        </p>
        <p>It is all-or-nothing: if anything changes while it runs, nothing is saved and it retries.</p>
        {label && <p className="font-medium">{label}</p>}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
