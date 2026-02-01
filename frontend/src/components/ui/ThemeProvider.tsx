/**
 * Theme Provider
 * 
 * Manages dark mode state with system preference detection.
 * Persists user preference to localStorage and applies theme class to document.
 * 
 * @module components/ui/ThemeProvider
 * 
 * Features:
 * - Three modes: 'light', 'dark', 'system' (follows OS preference)
 * - Persists to localStorage
 * - Applies 'dark' class to `<html>` for Tailwind CSS
 * - Listens for OS preference changes when in 'system' mode
 * 
 * @example
 * ```tsx
 * // In App.tsx
 * <ThemeProvider defaultTheme="system">
 *   <App />
 * </ThemeProvider>
 * 
 * // In a component
 * const { theme, toggleTheme, resolvedTheme } = useTheme();
 * ```
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

// ============================================
// TYPES
// ============================================

/**
 * Theme preference options
 * - 'light': Always light mode
 * - 'dark': Always dark mode
 * - 'system': Follow OS preference
 */
export type Theme = 'light' | 'dark' | 'system';

/**
 * Theme context value type
 * @property {Theme} theme - Current theme setting ('light', 'dark', or 'system')
 * @property {'light' | 'dark'} resolvedTheme - Actual applied theme after resolving 'system'
 * @property {Function} setTheme - Set theme preference
 * @property {Function} toggleTheme - Toggle between light and dark
 */
interface ThemeContextType {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

// ============================================
// CONTEXT
// ============================================

const ThemeContext = createContext<ThemeContextType | null>(null);

/**
 * Hook to access theme context
 * 
 * @returns {ThemeContextType} Theme state and controls
 * @throws {Error} If used outside of ThemeProvider
 * 
 * @example
 * ```tsx
 * function ThemeSwitch() {
 *   const { theme, setTheme } = useTheme();
 *   return (
 *     <select value={theme} onChange={(e) => setTheme(e.target.value)}>
 *       <option value="light">Light</option>
 *       <option value="dark">Dark</option>
 *       <option value="system">System</option>
 *     </select>
 *   );
 * }
 * ```
 */
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// ============================================
// PROVIDER
// ============================================

/**
 * Props for ThemeProvider component
 */
interface ThemeProviderProps {
  /** Child components that will have access to theme context */
  children: ReactNode;
  /** Initial theme if none saved in localStorage (default: 'system') */
  defaultTheme?: Theme;
}

export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('cloudvault_theme') as Theme | null;
      return stored || defaultTheme;
    }
    return defaultTheme;
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  // Resolve system theme
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const updateResolvedTheme = () => {
      if (theme === 'system') {
        setResolvedTheme(mediaQuery.matches ? 'dark' : 'light');
      } else {
        setResolvedTheme(theme);
      }
    };

    updateResolvedTheme();
    mediaQuery.addEventListener('change', updateResolvedTheme);
    
    return () => mediaQuery.removeEventListener('change', updateResolvedTheme);
  }, [theme]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [resolvedTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('cloudvault_theme', newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    const newTheme = resolvedTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  }, [resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ============================================
// THEME TOGGLE BUTTON
// ============================================

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      aria-label={`Switch to ${resolvedTheme === 'light' ? 'dark' : 'light'} mode`}
    >
      {resolvedTheme === 'light' ? (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      )}
    </button>
  );
}
