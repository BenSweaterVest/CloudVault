import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { VaultProvider } from './hooks/useVault'
import { ToastProvider } from './components/ui/Toast'
import { ThemeProvider } from './components/ui/ThemeProvider'
import LoginForm from './components/auth/LoginForm'
import MasterPasswordSetup from './components/auth/MasterPasswordSetup'
import GithubCallback from './components/auth/GithubCallback'
import SecretList from './components/vault/SecretList'
import SecretForm from './components/vault/SecretForm'
import ImportExport from './components/vault/ImportExport'
import UserPreferences from './components/settings/UserPreferences'
import AuditLog from './components/admin/AuditLog'
import UserManagement from './components/admin/UserManagement'
import HealthDashboard from './components/admin/HealthDashboard'
import OrgSettings from './components/admin/OrgSettings'
import Layout from './components/ui/Layout'
import ErrorBoundary from './components/ui/ErrorBoundary'
import NotFound from './components/ui/NotFound'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-vault-600"></div>
      </div>
    )
  }
  
  if (!user) {
    return <Navigate to="/login" replace />
  }
  
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginForm />} />
      <Route path="/auth/github/callback" element={<GithubCallback />} />
      <Route path="/setup" element={<MasterPasswordSetup />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout>
              <SecretList />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/secrets/new"
        element={
          <ProtectedRoute>
            <Layout>
              <SecretForm />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/secrets/:id/edit"
        element={
          <ProtectedRoute>
            <Layout>
              <SecretForm />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/audit"
        element={
          <ProtectedRoute>
            <Layout>
              <AuditLog />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedRoute>
            <Layout>
              <UserManagement />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/health"
        element={
          <ProtectedRoute>
            <Layout>
              <HealthDashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Layout>
              <OrgSettings />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/import-export"
        element={
          <ProtectedRoute>
            <Layout>
              <ImportExport />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/preferences"
        element={
          <ProtectedRoute>
            <Layout>
              <UserPreferences />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
            <AuthProvider>
              <VaultProvider>
                <AppRoutes />
              </VaultProvider>
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
