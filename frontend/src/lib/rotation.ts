/**
 * Org key rotation, run entirely in an admin's browser.
 *
 * 1. Download every ciphertext in the org (current and history) and the
 *    public keys of all active members and emergency contacts.
 * 2. Generate a new org key, decrypt everything with the old key and
 *    re-encrypt it with the new one (always in the current format).
 * 3. Encrypt the new key for each member and contact.
 * 4. Commit in one request. The server applies it atomically, or rejects it
 *    (409) if anything changed in the meantime, in which case we retry.
 *
 * Use after removing a member: they may have kept a copy of the old key.
 */

import { ApiError, orgsApi } from './api';
import { decryptSecretPayload, encryptOrgKeyFor, encryptSecretPayload, generateOrgKey } from './crypto';

export interface RotationProgress {
  stage: 'downloading' | 'reencrypting' | 'uploading' | 'done';
  done: number;
  total: number;
}

const MAX_ATTEMPTS = 3;

export async function rotateOrgKey(
  orgId: string,
  oldKey: CryptoKey,
  onProgress: (p: RotationProgress) => void = () => undefined
): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptRotation(orgId, oldKey, onProgress);
    } catch (err) {
      const conflict = err instanceof ApiError && err.code === 'ROTATION_CONFLICT';
      if (!conflict || attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}

async function attemptRotation(orgId: string, oldKey: CryptoKey, onProgress: (p: RotationProgress) => void): Promise<number> {
  onProgress({ stage: 'downloading', done: 0, total: 1 });
  const data = await orgsApi.getKeyRotationData(orgId);
  const newKey = await generateOrgKey();

  const total = data.secrets.length + data.history.length;
  let done = 0;
  const tick = () => onProgress({ stage: 'reencrypting', done: ++done, total });

  const secrets = [];
  for (const s of data.secrets) {
    const payload = await decryptSecretPayload(s, oldKey, orgId, s.id);
    secrets.push({ id: s.id, ...(await encryptSecretPayload(payload, newKey, orgId, s.id)) });
    tick();
  }

  const history = [];
  for (const h of data.history) {
    const payload = await decryptSecretPayload(h, oldKey, orgId, h.secretId);
    history.push({ id: h.id, ...(await encryptSecretPayload(payload, newKey, orgId, h.secretId)) });
    tick();
  }

  const memberKeys = await Promise.all(
    data.members.map(async (m) => ({ userId: m.userId, encryptedOrgKey: await encryptOrgKeyFor(newKey, m.publicKey) }))
  );
  const emergencyKeys = await Promise.all(
    data.emergencyContacts.map(async (e) => ({ contactId: e.contactId, encryptedOrgKey: await encryptOrgKeyFor(newKey, e.publicKey) }))
  );

  onProgress({ stage: 'uploading', done: total, total });
  const result = await orgsApi.commitKeyRotation(orgId, {
    fromKeyVersion: data.keyVersion,
    secrets,
    history,
    memberKeys,
    emergencyKeys,
  });
  onProgress({ stage: 'done', done: total, total });
  return result.keyVersion;
}
