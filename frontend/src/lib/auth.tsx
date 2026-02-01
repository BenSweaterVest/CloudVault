/**
 * CloudVault Auth Context
 * 
 * Manages authentication state and user session.
 * Provides login, logout, and session refresh functionality.
 * 
 * @module lib/auth
 * 
 * @example
 * ```tsx
 * // In App.tsx
 * <AuthProvider>
 *   <App />
 * </AuthProvider>
 * 
 * // In a component
 * const { user, login, logout } = useAuth();
 * ```
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { authApi, type User } from './api';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Authentication context type definition
 * 
 * @property {User | null} user - Currently authenticated user, or null if not logged in
 * @property {boolean} isLoading - True while checking existing session on mount
 * @property {boolean} isNewUser - True if user needs to set up encryption keys
 * @property {Function} login - Store JWT token and user data after successful authentication
 * @property {Function} logout - Clear session and redirect to login
 * @property {Function} refreshUser - Fetch current user data from API
 * @property {Function} updateUser - Update local user state (e.g., after key setup)
 */
interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isNewUser: boolean;
  login: (token: string, user: User, isNew: boolean) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateUser: (user: User) => void;
}

// ============================================
// CONTEXT
// ============================================

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * Hook to access authentication context
 * 
 * @returns {AuthContextType} Authentication state and methods
 * @throws {Error} If used outside of AuthProvider
 * 
 * @example
 * ```tsx
 * function ProfileButton() {
 *   const { user, logout } = useAuth();
 *   return (
 *     <button onClick={logout}>
 *       Logout {user?.email}
 *     </button>
 *   );
 * }
 * ```
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// ============================================
// PROVIDER
// ============================================

/**
 * Props for AuthProvider component
 */
interface AuthProviderProps {
  /** Child components that will have access to auth context */
  children: ReactNode;
}

/**
 * Authentication Provider Component
 * 
 * Wraps the application to provide authentication state and methods.
 * Automatically checks for existing JWT token on mount and restores session.
 * 
 * @param {AuthProviderProps} props - Provider props
 * @returns {JSX.Element} Provider component wrapping children
 * 
 * @example
 * ```tsx
 * // In main App component
 * function App() {
 *   return (
 *     <AuthProvider>
 *       <Router>
 *         <Routes />
 *       </Router>
 *     </AuthProvider>
 *   );
 * }
 * ```
 */
export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewUser, setIsNewUser] = useState(false);

  // Check for existing session on mount
  useEffect(() => {
    const token = localStorage.getItem('cloudvault_token');
    if (token) {
      authApi
        .getCurrentUser()
        .then((user) => {
          setUser(user);
          // Check if user needs to set up keys
          setIsNewUser(!user.publicKey);
        })
        .catch(() => {
          localStorage.removeItem('cloudvault_token');
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback((token: string, user: User, isNew: boolean) => {
    localStorage.setItem('cloudvault_token', token);
    setUser(user);
    setIsNewUser(isNew || !user.publicKey);
  }, []);

  const logout = useCallback(() => {
    authApi.logout();
    setUser(null);
    setIsNewUser(false);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const user = await authApi.getCurrentUser();
      setUser(user);
      setIsNewUser(!user.publicKey);
    } catch {
      logout();
    }
  }, [logout]);

  const updateUser = useCallback((user: User) => {
    setUser(user);
    setIsNewUser(!user.publicKey);
  }, []);

  const value: AuthContextType = {
    user,
    isLoading,
    isNewUser,
    login,
    logout,
    refreshUser,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
