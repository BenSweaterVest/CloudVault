import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { PreferencesProvider, usePreferences } from './lib/preferences';
import { VaultProvider } from './hooks/useVault';
import { ToastProvider } from './components/ui/Toast';
import { ThemeProvider, useTheme } from './components/ui/ThemeProvider';
import ErrorBoundary from './components/ui/ErrorBoundary';
import Layout from './components/ui/Layout';
import NotFound from './components/ui/NotFound';
import { FullPageSpinner } from './components/ui/kit';
import LoginForm from './components/auth/LoginForm';
import GithubCallback from './components/auth/GithubCallback';
import MagicLinkVerify from './components/auth/MagicLinkVerify';
import MasterPasswordSetup from './components/auth/MasterPasswordSetup';
import VaultGate from './components/vault/VaultGate';
import SecretList from './components/vault/SecretList';
import SecretForm from './components/vault/SecretForm';
import ImportExport from './components/vault/ImportExport';
import SharedSecretPage from './components/share/SharedSecretPage';
import EmergencyAccessPage from './components/emergency/EmergencyAccessPage';
import UserPreferences from './components/settings/UserPreferences';
import AuditLog from './components/admin/AuditLog';
import UserManagement from './components/admin/UserManagement';
import HealthDashboard from './components/admin/HealthDashboard';
import OrgSettings from './components/admin/OrgSettings';

/** Signed in with keys set up; renders inside the app shell. */
function Protected({ children, vault = false, adminOnly = false }: { children: ReactNode; vault?: boolean; adminOnly?: boolean }) {
  const { user, isLoading, needsKeySetup } = useAuth();
  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (needsKeySetup) return <Navigate to="/setup" replace />;
  return <Layout>{vault ? <VaultGate adminOnly={adminOnly}>{children}</VaultGate> : children}</Layout>;
}

/** Apply the saved theme preference once it loads. */
function ThemeSync() {
  const { preferences, isLoaded } = usePreferences();
  const { setTheme } = useTheme();
  useEffect(() => {
    if (isLoaded) setTheme(preferences.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, preferences.theme]);
  return null;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginForm />} />
      <Route path="/auth/github/callback" element={<GithubCallback />} />
      <Route path="/auth/magic-link" element={<MagicLinkVerify />} />
      <Route path="/share/:linkId" element={<SharedSecretPage />} />
      <Route path="/setup" element={<MasterPasswordSetup />} />

      {/* Vault */}
      <Route path="/" element={<Protected vault><SecretList /></Protected>} />
      <Route path="/secrets/new" element={<Protected vault><SecretForm /></Protected>} />
      <Route path="/secrets/:id/edit" element={<Protected vault><SecretForm /></Protected>} />
      <Route path="/import-export" element={<Protected vault><ImportExport /></Protected>} />
      <Route path="/health" element={<Protected vault><HealthDashboard /></Protected>} />
      <Route path="/users" element={<Protected vault adminOnly><UserManagement /></Protected>} />
      <Route path="/audit" element={<Protected vault adminOnly><AuditLog /></Protected>} />
      <Route path="/settings" element={<Protected vault adminOnly><OrgSettings /></Protected>} />

      {/* Account */}
      <Route path="/preferences" element={<Protected><UserPreferences /></Protected>} />
      <Route path="/emergency" element={<Protected><EmergencyAccessPage /></Protected>} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
            <AuthProvider>
              <PreferencesProvider>
                <ThemeSync />
                <VaultProvider>
                  <AppRoutes />
                </VaultProvider>
              </PreferencesProvider>
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
