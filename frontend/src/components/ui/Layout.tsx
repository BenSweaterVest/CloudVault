/**
 * Main Layout Component
 * 
 * Provides the application shell with responsive navigation,
 * organization selector, and user menu.
 * 
 * @module components/ui/Layout
 */

import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useVault } from '../../hooks/useVault';
import { ThemeToggle } from './ThemeProvider';
import { SkipLink, useFocusRing } from './Accessibility';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const { currentOrg, organizations, selectOrg, lock, isUnlocked } = useVault();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Initialize focus ring detection
  useFocusRing();

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close mobile menu on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mobileMenuOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when not in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        // Focus search - dispatch custom event
        window.dispatchEvent(new CustomEvent('cloudvault:focus-search'));
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        navigate('/secrets/new');
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        lock();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigate, lock]);

  const handleLogout = () => {
    lock();
    logout();
    navigate('/login');
  };

  const handleOrgChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const orgId = e.target.value;
    if (orgId) {
      selectOrg(orgId);
    }
  };

  const isActive = (path: string) => location.pathname === path;

  // Announce page changes for screen readers
  useEffect(() => {
    const pageTitle = document.title || 'CloudVault';
    const announcement = `Navigated to ${pageTitle}`;
    let liveRegion = document.getElementById('route-announcer');
    if (!liveRegion) {
      liveRegion = document.createElement('div');
      liveRegion.id = 'route-announcer';
      liveRegion.setAttribute('role', 'status');
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.className = 'sr-only';
      document.body.appendChild(liveRegion);
    }
    liveRegion.textContent = announcement;
  }, [location.pathname]);

  const navLinks = [
    { path: '/', label: 'Passwords', adminOnly: false },
    { path: '/import-export', label: 'Import/Export', adminOnly: false },
    { path: '/health', label: 'Health', adminOnly: true },
    { path: '/users', label: 'Users', adminOnly: true },
    { path: '/audit', label: 'Audit Log', adminOnly: true },
    { path: '/settings', label: 'Settings', adminOnly: true },
  ];

  const visibleLinks = navLinks.filter(
    (link) => !link.adminOnly || currentOrg?.role === 'admin'
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Skip Link for Keyboard Navigation */}
      <SkipLink targetId="main-content" />
      
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-2" aria-label="CloudVault Home">
              <svg
                className="h-8 w-8 text-vault-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                <circle cx="12" cy="16" r="1" />
              </svg>
              <span className="text-xl font-bold text-gray-900 dark:text-gray-100">CloudVault</span>
            </Link>

            {/* Organization Selector - Desktop */}
            {organizations.length > 0 && isUnlocked && (
              <div className="hidden sm:block">
                <label htmlFor="org-selector" className="sr-only">Select Organization</label>
                <select
                  id="org-selector"
                  value={currentOrg?.id || ''}
                  onChange={handleOrgChange}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-vault-500"
                >
                  <option value="">Select Organization</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Desktop User Menu */}
            <div className="hidden sm:flex items-center space-x-4">
              <ThemeToggle />
              <Link
                to="/preferences"
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                title="Preferences"
              >
                {user?.email}
              </Link>
              {isUnlocked && (
                <button
                  onClick={lock}
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  aria-label="Lock vault"
                  title="Lock vault (Ctrl+L)"
                >
                  Lock
                </button>
              )}
              <button
                onClick={handleLogout}
                className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                aria-label="Sign out"
              >
                Logout
              </button>
            </div>

            {/* Mobile Menu Button */}
            <div className="flex sm:hidden items-center space-x-2">
              <ThemeToggle />
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-menu"
                aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              >
                {mobileMenuOpen ? (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div 
            id="mobile-menu" 
            className="sm:hidden border-t border-gray-200 dark:border-gray-700"
          >
            <div className="px-4 py-3 space-y-3">
              {/* Organization Selector - Mobile */}
              {organizations.length > 0 && isUnlocked && (
                <div>
                  <label htmlFor="org-selector-mobile" className="sr-only">Select Organization</label>
                  <select
                    id="org-selector-mobile"
                    value={currentOrg?.id || ''}
                    onChange={handleOrgChange}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-vault-500"
                  >
                    <option value="">Select Organization</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Navigation Links - Mobile */}
              {currentOrg && isUnlocked && (
                <nav className="space-y-1" aria-label="Mobile navigation">
                  {visibleLinks.map((link) => (
                    <Link
                      key={link.path}
                      to={link.path}
                      className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                        isActive(link.path)
                          ? 'bg-vault-50 dark:bg-vault-900/20 text-vault-600 dark:text-vault-400'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      aria-current={isActive(link.path) ? 'page' : undefined}
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>
              )}

              {/* User Actions - Mobile */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
                <Link
                  to="/preferences"
                  className="block px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  Preferences ({user?.email})
                </Link>
                {isUnlocked && (
                  <button
                    onClick={lock}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    Lock Vault
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Desktop Navigation */}
      {currentOrg && isUnlocked && (
        <nav className="hidden sm:block bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700" aria-label="Main navigation">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex space-x-8 h-12">
              {visibleLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`inline-flex items-center border-b-2 px-1 text-sm font-medium transition-colors ${
                    isActive(link.path)
                      ? 'border-vault-500 text-vault-600 dark:text-vault-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                  aria-current={isActive(link.path) ? 'page' : undefined}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>
      )}

      {/* Keyboard Shortcuts Help (hidden, shown in footer) */}
      <div className="sr-only" aria-hidden="true">
        Keyboard shortcuts: Ctrl+K to search, Ctrl+N to create new, Ctrl+L to lock
      </div>

      {/* Main Content */}
      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" tabIndex={-1}>
        {children}
      </main>

      {/* Footer with Keyboard Shortcuts */}
      <footer className="hidden sm:block border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
            <span>&copy; {new Date().getFullYear()} CloudVault</span>
            <div className="flex space-x-4">
              <span className="hidden lg:inline">
                <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">⌘K</kbd> Search
              </span>
              <span className="hidden lg:inline">
                <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">⌘N</kbd> New
              </span>
              <span className="hidden lg:inline">
                <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">⌘L</kbd> Lock
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
