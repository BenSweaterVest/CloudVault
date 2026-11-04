/**
 * Create or edit an item. Every field except name, website, username hint,
 * category, tags and expiry is encrypted in the browser.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useVault } from '../../hooks/useVault';
import { ApiError, categoriesApi, orgSettingsApi, type Category, type OrgSettings, type SecretType } from '../../lib/api';
import type { CustomField, SecretPayload } from '../../lib/crypto';
import { assessPassword } from '../../lib/passwords';
import { parseTotp } from '../../lib/totp';
import { useToast } from '../ui/Toast';
import { Alert, Button, Card, Checkbox, Field, PageHeader, Select, Spinner, TextArea, TextInput, errorMessage } from '../ui/kit';
import PasswordGenerator from './PasswordGenerator';
import { SECRET_TYPE_LABELS } from './SecretList';

interface FormState {
  secretType: SecretType;
  name: string;
  url: string;
  username: string;
  password: string;
  apiKey: string;
  totp: string;
  notes: string;
  cardHolder: string;
  cardNumber: string;
  cardExpiry: string;
  cardCvv: string;
  cardPin: string;
  customFields: CustomField[];
  categoryId: string;
  tags: string;
  expiresAt: string; // yyyy-mm-dd or ''
}

const EMPTY: FormState = {
  secretType: 'password',
  name: '',
  url: '',
  username: '',
  password: '',
  apiKey: '',
  totp: '',
  notes: '',
  cardHolder: '',
  cardNumber: '',
  cardExpiry: '',
  cardCvv: '',
  cardPin: '',
  customFields: [],
  categoryId: '',
  tags: '',
  expiresAt: '',
};

const opt = (v: string) => (v.trim() ? v : undefined);

function toPayload(f: FormState): SecretPayload {
  const card =
    f.secretType === 'card'
      ? { holder: opt(f.cardHolder), number: opt(f.cardNumber.replace(/\s+/g, ' ')), expiry: opt(f.cardExpiry), cvv: opt(f.cardCvv), pin: opt(f.cardPin) }
      : undefined;
  const custom = f.customFields.filter((c) => c.label.trim());
  return {
    username: opt(f.username),
    password: opt(f.password),
    apiKey: opt(f.apiKey),
    totp: opt(f.totp),
    notes: opt(f.notes),
    card,
    customFields: custom.length ? custom : undefined,
  };
}

function fromPayload(p: SecretPayload): Partial<FormState> {
  return {
    username: p.username ?? '',
    password: p.password ?? '',
    apiKey: p.apiKey ?? '',
    totp: p.totp ?? '',
    notes: p.notes ?? '',
    cardHolder: p.card?.holder ?? '',
    cardNumber: p.card?.number ?? '',
    cardExpiry: p.card?.expiry ?? '',
    cardCvv: p.card?.cvv ?? '',
    cardPin: p.card?.pin ?? '',
    customFields: p.customFields ?? [],
  };
}

/** Normalized URL: add https:// when the scheme is missing. */
function normalizeUrl(value: string): string {
  const v = value.trim();
  if (!v) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
}

function dateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

export default function SecretForm() {
  const { id } = useParams<{ id?: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const { currentOrg, openSecret, createSecret, updateSecret } = useVault();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [original, setOriginal] = useState<{ payload: string; version: number } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    categoriesApi.list(currentOrg.id).then(setCategories).catch(() => undefined);
    orgSettingsApi
      .get(currentOrg.id)
      .then((s) => {
        setSettings(s);
        if (!isEditing && s.passwordExpiryDays > 0) {
          const d = new Date(Date.now() + s.passwordExpiryDays * 86_400_000);
          setForm((f) => (f.expiresAt ? f : { ...f, expiresAt: d.toISOString().slice(0, 10) }));
        }
      })
      .catch(() => undefined);
  }, [currentOrg, isEditing]);

  useEffect(() => {
    if (!id) return;
    openSecret(id)
      .then(({ secret, payload }) => {
        setForm({
          ...EMPTY,
          ...fromPayload(payload),
          secretType: secret.secretType,
          name: secret.name,
          url: secret.url ?? '',
          categoryId: secret.categoryId ?? '',
          tags: secret.tags.join(', '),
          expiresAt: dateInputValue(secret.expiresAt),
        });
        setOriginal({ payload: JSON.stringify(payload), version: secret.version });
      })
      .catch((err) => setError(errorMessage(err, 'Could not load this item')))
      .finally(() => setLoading(false));
  }, [id, openSecret]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const strength = useMemo(() => assessPassword(form.password), [form.password]);
  const minLength = settings?.minPasswordLength ?? 12;
  const totpInvalid = form.totp.trim() !== '' && !parseTotp(form.totp);
  const t = form.secretType;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (totpInvalid) {
      setError('The 2FA secret is not a valid base32 secret or otpauth:// link');
      return;
    }
    setSaving(true);
    setError(null);

    const payload = toPayload(form);
    const tags = [...new Set(form.tags.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 20);
    const input = {
      name: form.name.trim(),
      url: normalizeUrl(form.url),
      usernameHint: form.username.trim().slice(0, 200),
      categoryId: form.categoryId || null,
      secretType: form.secretType,
      tags,
      expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59Z`).toISOString() : null,
    };

    try {
      if (isEditing && id && original) {
        const changed = JSON.stringify(payload) !== original.payload;
        await updateSecret(id, input, changed ? payload : undefined, original.version);
        toast.success('Saved');
        navigate(`/?secret=${id}`);
      } else {
        const created = await createSecret(input, payload);
        toast.success('Item created');
        navigate(`/?secret=${created.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        setError('Someone else changed this item while you were editing. Copy your changes, reload the page and try again.');
      } else {
        setError(errorMessage(err, 'Could not save'));
      }
    } finally {
      setSaving(false);
    }
  };

  if (currentOrg?.role === 'read_only') return <Alert tone="warning">You have read-only access to {currentOrg.name}.</Alert>;
  if (loading) {
    return (
      <div className="flex justify-center py-16 text-vault-600">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={isEditing ? 'Edit item' : 'New item'} description="Everything except the name, website, username, category, tags and expiry date is encrypted on this device." />
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              {(fid) => (
                <Select id={fid} value={t} onChange={(e) => set('secretType', e.target.value as SecretType)}>
                  {Object.entries(SECRET_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Name">
              {(fid) => <TextInput id={fid} required maxLength={200} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Bank of the West" />}
            </Field>
            {(t === 'password' || t === 'api_key' || t === 'totp') && (
              <div className="sm:col-span-2">
                <Field label="Website">
                  {(fid) => <TextInput id={fid} inputMode="url" value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://example.com" />}
                </Field>
              </div>
            )}
          </div>
        </Card>

        <Card title="Details">
          <div className="space-y-4">
            {(t === 'password' || t === 'totp' || t === 'api_key') && (
              <Field label="Username or email" hint="Shown in the list (stored unencrypted so you can search it).">
                {(fid) => <TextInput id={fid} autoComplete="off" value={form.username} onChange={(e) => set('username', e.target.value)} />}
              </Field>
            )}

            {t === 'password' && (
              <Field label="Password">
                {(fid) => (
                  <>
                    <div className="flex gap-2">
                      <TextInput
                        id={fid}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        className="font-mono"
                        value={form.password}
                        onChange={(e) => set('password', e.target.value)}
                      />
                      <Button variant="secondary" onClick={() => setShowPassword((s) => !s)}>
                        {showPassword ? 'Hide' : 'Show'}
                      </Button>
                      <Button variant="secondary" onClick={() => setShowGenerator(true)}>
                        Generate
                      </Button>
                    </div>
                    {form.password && (
                      <div className="mt-2">
                        <div className="flex gap-1">
                          {[0, 1, 2, 3].map((i) => (
                            <div key={i} className={`h-1 flex-1 rounded-full ${i < strength.score ? strength.barClass : 'bg-gray-200 dark:bg-gray-700'}`} />
                          ))}
                        </div>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {strength.label}
                          {strength.feedback ? `. ${strength.feedback}` : ''}
                          {form.password.length < minLength ? `. Your organization asks for at least ${minLength} characters.` : ''}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </Field>
            )}

            {t === 'api_key' && (
              <Field label="API key or token">
                {(fid) => <TextArea id={fid} rows={3} className="font-mono" value={form.apiKey} onChange={(e) => set('apiKey', e.target.value)} />}
              </Field>
            )}

            {t === 'card' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Cardholder name">{(fid) => <TextInput id={fid} value={form.cardHolder} onChange={(e) => set('cardHolder', e.target.value)} />}</Field>
                <Field label="Card number">
                  {(fid) => <TextInput id={fid} inputMode="numeric" autoComplete="off" className="font-mono" value={form.cardNumber} onChange={(e) => set('cardNumber', e.target.value)} />}
                </Field>
                <Field label="Expiry (MM/YY)">{(fid) => <TextInput id={fid} value={form.cardExpiry} onChange={(e) => set('cardExpiry', e.target.value)} />}</Field>
                <Field label="Security code">
                  {(fid) => <TextInput id={fid} type="password" autoComplete="off" value={form.cardCvv} onChange={(e) => set('cardCvv', e.target.value)} />}
                </Field>
                <Field label="PIN">{(fid) => <TextInput id={fid} type="password" autoComplete="off" value={form.cardPin} onChange={(e) => set('cardPin', e.target.value)} />}</Field>
              </div>
            )}

            {(t === 'password' || t === 'totp') && (
              <Field
                label="2FA secret (optional for logins)"
                hint="The setup key or otpauth:// link from the site's two-factor setup page. CloudVault will show the current code."
                error={totpInvalid ? 'Not a valid base32 secret or otpauth:// link' : null}
              >
                {(fid) => <TextInput id={fid} autoComplete="off" className="font-mono" value={form.totp} onChange={(e) => set('totp', e.target.value)} />}
              </Field>
            )}

            <Field label="Notes">{(fid) => <TextArea id={fid} rows={t === 'note' ? 10 : 3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />}</Field>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Custom fields</span>
                <Button variant="ghost" size="sm" onClick={() => set('customFields', [...form.customFields, { label: '', value: '', hidden: false }])}>
                  Add field
                </Button>
              </div>
              {form.customFields.map((cf, i) => (
                <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                  <TextInput
                    aria-label={`Field ${i + 1} name`}
                    placeholder="Name"
                    value={cf.label}
                    onChange={(e) => set('customFields', form.customFields.map((c, j) => (j === i ? { ...c, label: e.target.value } : c)))}
                  />
                  <TextInput
                    aria-label={`Field ${i + 1} value`}
                    placeholder="Value"
                    type={cf.hidden ? 'password' : 'text'}
                    value={cf.value}
                    onChange={(e) => set('customFields', form.customFields.map((c, j) => (j === i ? { ...c, value: e.target.value } : c)))}
                  />
                  <Checkbox
                    label="Hidden"
                    checked={cf.hidden}
                    onChange={(e) => set('customFields', form.customFields.map((c, j) => (j === i ? { ...c, hidden: e.target.checked } : c)))}
                  />
                  <Button variant="ghost" size="sm" aria-label={`Remove field ${i + 1}`} onClick={() => set('customFields', form.customFields.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Organize">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Category">
              {(fid) => (
                <Select id={fid} value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                  <option value="">None</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Tags" hint="Comma separated">
              {(fid) => <TextInput id={fid} value={form.tags} onChange={(e) => set('tags', e.target.value)} />}
            </Field>
            <Field label="Expires on" hint="You will be reminded on the Health page">
              {(fid) => <TextInput id={fid} type="date" value={form.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />}
            </Field>
          </div>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!form.name.trim()}>
            {isEditing ? 'Save changes' : 'Create item'}
          </Button>
        </div>
      </form>

      {showGenerator && <PasswordGenerator minLength={Math.min(minLength, 64)} onClose={() => setShowGenerator(false)} onSelect={(p) => set('password', p)} />}
    </div>
  );
}
