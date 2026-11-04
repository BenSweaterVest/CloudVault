/**
 * The password list for the current organization: search, filters, quick
 * copy, favorites and the detail view.
 *
 * The list holds metadata only. Copying or opening a secret fetches and
 * decrypts it on demand, which records a view in the audit log.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useVault } from '../../hooks/useVault';
import { useClipboard } from '../../hooks/useClipboard';
import { usePreferences } from '../../lib/preferences';
import { categoriesApi, type Category, type SecretMeta, type SecretType } from '../../lib/api';
import { useToast } from '../ui/Toast';
import { Badge, Button, PageHeader, Select, TextInput, cx, errorMessage } from '../ui/kit';
import SecretView from './SecretView';
import CategoryManager from './CategoryManager';

export const SECRET_TYPE_LABELS: Record<SecretType, string> = {
  password: 'Login',
  note: 'Secure note',
  api_key: 'API key',
  card: 'Payment card',
  totp: '2FA code',
};

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function expiryBadge(expiresAt: string | null) {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return <Badge color="red">Expired</Badge>;
  if (days <= 30) return <Badge color="amber">Expires in {days}d</Badge>;
  return null;
}

export default function SecretList() {
  const { currentOrg, secrets, openSecret, toggleFavorite, refreshSecrets } = useVault();
  const { preferences } = usePreferences();
  const { copy, copiedKey } = useClipboard();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [type, setType] = useState<SecretType | ''>('');
  const [categoryId, setCategoryId] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCategories, setShowCategories] = useState(false);

  const openId = params.get('secret');
  const setOpenId = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('secret', id);
    else next.delete('secret');
    setParams(next, { replace: true });
  };

  const loadCategories = useCallback(() => {
    if (!currentOrg) return;
    categoriesApi.list(currentOrg.id).then(setCategories).catch(() => setCategories([]));
  }, [currentOrg]);
  useEffect(loadCategories, [loadCategories]);

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener('cloudvault:focus-search', focus);
    return () => window.removeEventListener('cloudvault:focus-search', focus);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return secrets.filter((s) => {
      if (type && s.secretType !== type) return false;
      if (categoryId && s.categoryId !== categoryId) return false;
      if (favoritesOnly && !s.isFavorite) return false;
      if (!q) return true;
      return [s.name, s.url, s.usernameHint, s.categoryName, ...s.tags].some((v) => v?.toLowerCase().includes(q));
    });
  }, [secrets, query, type, categoryId, favoritesOnly]);

  const quickCopy = async (s: SecretMeta, field: 'username' | 'password') => {
    try {
      const { payload } = await openSecret(s.id);
      const value = field === 'username' ? payload.username : payload.password ?? payload.apiKey;
      if (!value) {
        toast.warning(`No ${field} saved for ${s.name}`);
        return;
      }
      if (await copy(value, `${s.id}:${field}`)) toast.success(`${field === 'username' ? 'Username' : 'Password'} copied`);
    } catch (err) {
      toast.error('Could not copy', errorMessage(err));
    }
  };

  const canWrite = currentOrg?.role !== 'read_only';
  const compact = preferences.compactView;

  return (
    <div>
      <PageHeader
        title="Passwords"
        description={`${secrets.length} item${secrets.length === 1 ? '' : 's'} in ${currentOrg?.name ?? ''}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowCategories(true)}>
              Categories
            </Button>
            {canWrite && <Button onClick={() => navigate('/secrets/new')}>New item</Button>}
          </>
        }
      />

      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <TextInput
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, website, username or tag"
          title="Shortcut: /"
          aria-label="Search"
        />
        <Select value={type} onChange={(e) => setType(e.target.value as SecretType | '')} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(SECRET_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button variant={favoritesOnly ? 'primary' : 'secondary'} onClick={() => setFavoritesOnly((f) => !f)} aria-pressed={favoritesOnly}>
          Favorites
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-300">{secrets.length === 0 ? 'No passwords yet.' : 'Nothing matches your search.'}</p>
          {secrets.length === 0 && canWrite && (
            <p className="mt-2 text-sm text-gray-500">
              <Link to="/secrets/new" className="font-medium text-vault-600">
                Add your first item
              </Link>{' '}
              or{' '}
              <Link to="/import-export" className="font-medium text-vault-600">
                import from another password manager
              </Link>
              .
            </p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
          {filtered.map((s) => (
            <li key={s.id} className={cx('flex items-center gap-3 px-4 hover:bg-gray-50 dark:hover:bg-gray-700/50', compact ? 'py-2' : 'py-3')}>
              <button
                onClick={() => void toggleFavorite(s.id).catch((err) => toast.error('Could not update favorite', errorMessage(err)))}
                className={cx('text-lg', s.isFavorite ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300 dark:text-gray-600')}
                aria-label={s.isFavorite ? `Remove ${s.name} from favorites` : `Add ${s.name} to favorites`}
                aria-pressed={s.isFavorite}
              >
                {s.isFavorite ? '★' : '☆'}
              </button>
              <button onClick={() => setOpenId(s.id)} className="min-w-0 flex-1 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-gray-900 dark:text-white">{s.name}</span>
                  {s.secretType !== 'password' && <Badge>{SECRET_TYPE_LABELS[s.secretType]}</Badge>}
                  {s.categoryName && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.categoryColor ?? '#6366f1' }} aria-hidden="true" />
                      {s.categoryName}
                    </span>
                  )}
                  {expiryBadge(s.expiresAt)}
                </div>
                {!compact && (
                  <p className="truncate text-sm text-gray-500 dark:text-gray-400">{[s.usernameHint, hostOf(s.url)].filter(Boolean).join(' · ') || ' '}</p>
                )}
              </button>
              {(s.secretType === 'password' || s.secretType === 'api_key') && (
                <div className="hidden gap-1 sm:flex">
                  {s.secretType === 'password' && (
                    <Button variant="ghost" size="sm" onClick={() => void quickCopy(s, 'username')}>
                      {copiedKey === `${s.id}:username` ? 'Copied' : 'Copy user'}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => void quickCopy(s, 'password')}>
                    {copiedKey === `${s.id}:password` ? 'Copied' : s.secretType === 'api_key' ? 'Copy key' : 'Copy password'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {openId && <SecretView secretId={openId} onClose={() => setOpenId(null)} />}
      {showCategories && (
        <CategoryManager
          isOpen={showCategories}
          onClose={() => setShowCategories(false)}
          onCategoriesUpdated={() => {
            loadCategories();
            void refreshSecrets();
          }}
        />
      )}
    </div>
  );
}
