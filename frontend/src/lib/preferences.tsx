/**
 * User preferences, loaded once after sign-in and shared app-wide so that
 * auto-lock and clipboard clearing use the user's actual settings.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { preferencesApi, type UserPreferences } from './api';
import { useAuth } from './auth';

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  sessionTimeout: 15,
  clipboardClear: 30,
  showFavicons: true,
  compactView: false,
};

interface PreferencesContextType {
  preferences: UserPreferences;
  isLoaded: boolean;
  update: (changes: Partial<UserPreferences>) => Promise<UserPreferences>;
}

const PreferencesContext = createContext<PreferencesContextType | null>(null);

export function usePreferences(): PreferencesContextType {
  const ctx = useContext(PreferencesContext);
  // Outside the provider (tests, public pages) fall back to defaults.
  return (
    ctx ?? {
      preferences: DEFAULT_PREFERENCES,
      isLoaded: false,
      update: async () => DEFAULT_PREFERENCES,
    }
  );
}

export function PreferencesProvider({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!user) {
      setPreferences(DEFAULT_PREFERENCES);
      setIsLoaded(false);
      return;
    }
    let cancelled = false;
    preferencesApi
      .get()
      .then((prefs) => {
        if (!cancelled) setPreferences(prefs);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const update = useCallback(async (changes: Partial<UserPreferences>) => {
    const saved = await preferencesApi.update(changes);
    setPreferences(saved);
    return saved;
  }, []);

  const value = useMemo(() => ({ preferences, isLoaded, update }), [preferences, isLoaded, update]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
