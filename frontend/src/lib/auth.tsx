/**
 * Authentication state: who is signed in, and whether they still need to
 * create their master password (key setup).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi, SESSION_ENDED_EVENT, tokenStore, type LoginResponse, type User } from './api';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  /** True until the user has set up their master password. */
  needsKeySetup: boolean;
  /** Set when the server ended the session (timeout, revoked). Cleared on login. */
  sessionEndedReason: string | null;
  login: (response: LoginResponse) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionEndedReason, setSessionEndedReason] = useState<string | null>(null);

  // Restore an existing session.
  useEffect(() => {
    if (!tokenStore.get()) {
      setIsLoading(false);
      return;
    }
    authApi
      .getCurrentUser()
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setIsLoading(false));
  }, []);

  // The API client announces when the server ends our session.
  useEffect(() => {
    const onEnded = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      tokenStore.clear();
      setUser(null);
      setSessionEndedReason(
        code === 'SESSION_TIMEOUT' ? 'You were signed out after a period of inactivity.' : 'Your session has ended. Please sign in again.'
      );
    };
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, []);

  const login = useCallback((response: LoginResponse) => {
    tokenStore.set(response.token);
    setUser(response.user);
    setSessionEndedReason(null);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    setUser(await authApi.getCurrentUser());
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isLoading,
      needsKeySetup: !!user && !user.publicKey,
      sessionEndedReason,
      login,
      logout,
      refreshUser,
      updateUser: setUser,
    }),
    [user, isLoading, sessionEndedReason, login, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
