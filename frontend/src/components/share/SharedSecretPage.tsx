/**
 * Public page for share links: /share/:linkId#<key>
 *
 * Works without an account. The key in the fragment decrypts the payload in
 * this browser. Opening the item uses up one view, so the content is only
 * fetched when the recipient clicks "Reveal".
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, sharingApi, type PublicShareInfo } from '../../lib/api';
import { deriveShareAccessToken, openSharePackage, type SecretPayload } from '../../lib/crypto';
import { Alert, AuthShell, Button, Field, Spinner, TextInput, errorMessage } from '../ui/kit';
import { PayloadFields } from '../vault/SecretView';
import TOTPDisplay from '../vault/TOTPDisplay';

export default function SharedSecretPage() {
  const { linkId = '' } = useParams();
  // Read the key once, then drop it from the address bar and history.
  const fragmentKey = useMemo(() => window.location.hash.slice(1), []);
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const [info, setInfo] = useState<PublicShareInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState<{ name: string; url: string | null; payload: SecretPayload; allowCopy: boolean } | null>(null);

  useEffect(() => {
    if (!fragmentKey) {
      setError('This link is incomplete: the part after # is missing. Ask the sender for the full link.');
      return;
    }
    sharingApi
      .publicInfo(linkId)
      .then(setInfo)
      .catch((err) => setError(errorMessage(err, 'This share link is not available')));
  }, [linkId, fragmentKey]);

  const reveal = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!info) return;
    setBusy(true);
    setError(null);
    try {
      const accessToken = info.requiresPassword && info.accessSalt ? await deriveShareAccessToken(password, info.accessSalt) : undefined;
      const data = await sharingApi.publicAccess(linkId, accessToken);
      const payload = await openSharePackage(data, fragmentKey, linkId).catch(() => {
        throw new Error('The link key does not match. Make sure you copied the whole link.');
      });
      setContent({ name: data.name, url: data.url, payload, allowCopy: data.allowCopy });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'PASSWORD_INCORRECT' ? 'Incorrect password' : errorMessage(err, 'Could not open this item'));
    } finally {
      setBusy(false);
    }
  };

  if (content) {
    return (
      <AuthShell title={content.name} subtitle="Shared with you through CloudVault">
        <div className="space-y-4" data-allow-copy={content.allowCopy}>
          {content.url && <p className="truncate text-sm text-gray-500">{content.url}</p>}
          {content.payload.totp && <TOTPDisplay value={content.payload.totp} />}
          <PayloadFields payload={content.payload} />
          <Alert tone="info">Save what you need now. This page will not show the item again once the link is used up or expires.</Alert>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={info ? info.secretName : 'Shared item'} subtitle={info ? `Shared by ${info.orgName}` : undefined}>
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {!info && !error && (
          <div className="flex justify-center text-vault-600">
            <Spinner />
          </div>
        )}
        {info && (
          <form onSubmit={reveal} className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {info.remainingViews !== null
                ? `This link can be opened ${info.remainingViews} more time${info.remainingViews === 1 ? '' : 's'}.`
                : 'This link can be opened until it expires.'}{' '}
              It expires {new Date(info.expiresAt).toLocaleString()}.
            </p>
            {info.requiresPassword && (
              <Field label="Password">
                {(id) => <TextInput id={id} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
              </Field>
            )}
            <Button type="submit" className="w-full" loading={busy}>
              Reveal
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
