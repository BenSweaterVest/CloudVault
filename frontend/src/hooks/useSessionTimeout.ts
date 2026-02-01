/**
 * Session Timeout Hook
 * 
 * Auto-locks the vault after a period of inactivity.
 */

import { useEffect, useRef, useCallback } from 'react';

interface UseSessionTimeoutOptions {
  timeoutMinutes: number;
  onTimeout: () => void;
  enabled?: boolean;
}

export function useSessionTimeout({
  timeoutMinutes,
  onTimeout,
  enabled = true,
}: UseSessionTimeoutOptions) {
  const timeoutRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    if (enabled && timeoutMinutes > 0) {
      timeoutRef.current = window.setTimeout(() => {
        onTimeout();
      }, timeoutMinutes * 60 * 1000);
    }
  }, [timeoutMinutes, onTimeout, enabled]);

  // Set up activity listeners
  useEffect(() => {
    if (!enabled) return;

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    
    const handleActivity = () => {
      resetTimer();
    };

    events.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Initial timer
    resetTimer();

    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled, resetTimer]);

  // Lock on visibility change (tab hidden)
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Optional: Could trigger immediate lock when tab is hidden
        // For now, just note the time
        lastActivityRef.current = Date.now();
      } else {
        // Check if we've been away too long
        const elapsed = Date.now() - lastActivityRef.current;
        if (elapsed > timeoutMinutes * 60 * 1000) {
          onTimeout();
        } else {
          resetTimer();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, timeoutMinutes, onTimeout, resetTimer]);

  return {
    resetTimer,
    getTimeUntilTimeout: () => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = (timeoutMinutes * 60 * 1000) - elapsed;
      return Math.max(0, remaining);
    },
  };
}
