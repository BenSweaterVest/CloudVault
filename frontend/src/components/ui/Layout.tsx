/**
 * Application shell: header, navigation, organization switcher, lock and
 * account menu. Also enforces the client-side auto-lock.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { usePreferences } from '../../lib/preferences';
import { useVault } from '../../hooks/useVault';
import { useSessionTimeout } from '../../hooks/useSessionTimeout';
import { ThemeToggle } from './ThemeProvider';
import { SkipLink, useFocusRing } from './Accessibility';
import { LockIcon, cx } from './kit';
import { useToast } from './Toast';

const NAV = [
  { path: '/', label: 'Passwords', adminOnly: false },
  { path: '/health', label: 'Health', adminOnly: false },
  { path: '/import-export', label: 'Import / Export', adminOnly: false },
  { path: '/users', label: 'Members', adminOnly: true },
  { path: '/audit', label: 'Audit log', adminOnly: true },
  { path: '/settings', label: 'Settings', adminOnly: true },
];

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { preferences } = usePreferences();
  const { currentOrg, organizations, selectOrg, lock, isUnlocked } = useVault();
  const { info } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  useFocusRing();

  const autoLock = useCallback(() => {
    lock();
    info('Vault locked', 'Locked after a period of inactivity');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lock]);

  useSessionTimeout({ timeoutMinutes: preferences.sessionTimeout, onTimeout: autoLock, enabled: isUnlocked });

  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Single-key shortcuts, ignored while typing: "/" search, "n" new, "l" lock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        if (location.pathname !== '/') navigate('/');
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('cloudvault:focus-search')), 0);
      } else if (e.key === 'n' && isUnlocked && currentOrg && currentOrg.role !== 'read_only') {
        navigate('/secrets/new');
      } else if (e.key === 'l' && isUnlocked) {
        lock();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate, lock, isUnlocked, currentOrg, location.pathname]);

  const handleLogout = async () => {
    lock();
    await logout();
    navigate('/login');
  };

  const isAdmin = currentOrg?.role === 'admin';
  const links = NAV.filter((l) => !l.adminOnly || isAdmin);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SkipLink targetId="main-content" />
      <header className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
            <LockIcon className="h-7 w-7 text-vault-600" />
            <span className="hidden sm:inline">CloudVault</span>
          </Link>

          {isUnlocked && currentOrg && (
            <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Main">
              {links.map((l) => (
                <NavLink
                  key={l.path}
                  to={l.path}
                  end={l.path === '/'}
                  className={({ isActive }) =>
                    cx(
                      'rounded-md px-3 py-2 text-sm font-medium',
                      isActive ? 'bg-vault-50 text-vault-700 dark:bg-vault-900/40 dark:text-vault-200' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                    )
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="flex-1 lg:hidden" />

          <div className="flex items-center gap-2">
            {isUnlocked && organizations.length > 1 && (
              <select
                aria-label="Organization"
                value={currentOrg?.id ?? ''}
                onChange={(e) => void selectOrg(e.target.value)}
                className="max-w-[10rem] rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-8 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            {isUnlocked && (
              <button
                onClick={lock}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                title="Lock vault (l)"
              >
                Lock
              </button>
            )}
            <ThemeToggle />
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-vault-100 text-sm font-semibold text-vault-700 dark:bg-vault-900 dark:text-vault-200"
                aria-label="Account menu"
              >
                {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 z-40 mt-2 w-60 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                  <div className="border-b border-gray-100 px-4 py-2 text-sm dark:border-gray-700">
                    <p className="truncate font-medium text-gray-900 dark:text-white">{user?.name || user?.email}</p>
                    {currentOrg && (
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {currentOrg.name} ({currentOrg.role.replace('_', '-')})
                      </p>
                    )}
                  </div>
                  {isUnlocked &&
                    links.map((l) => (
                      <Link key={l.path} role="menuitem" to={l.path} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700 lg:hidden">
                        {l.label}
                      </Link>
                    ))}
                  <Link role="menuitem" to="/preferences" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700">
                    Preferences and security
                  </Link>
                  <Link role="menuitem" to="/emergency" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700">
                    Emergency access
                  </Link>
                  <button role="menuitem" onClick={() => void handleLogout()} className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-50 dark:text-red-400 dark:hover:bg-gray-700">
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
