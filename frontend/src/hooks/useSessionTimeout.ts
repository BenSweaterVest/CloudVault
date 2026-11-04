/**
 * Calls `onTimeout` after `timeoutMinutes` without user activity.
 *
 * Also checks when the tab becomes visible again, because browsers throttle
 * timers in background tabs. A timeout of 0 disables it.
 */

import { useEffect, useRef } from 'react';

interface UseSessionTimeoutOptions {
  timeoutMinutes: number;
  onTimeout: () => void;
  enabled?: boolean;
}

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

export function useSessionTimeout({ timeoutMinutes, onTimeout, enabled = true }: UseSessionTimeoutOptions): void {
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!enabled || timeoutMinutes <= 0) return;

    const limit = timeoutMinutes * 60_000;
    let lastActivity = Date.now();
    let timer = 0;

    const fire = () => {
      window.clearTimeout(timer);
      onTimeoutRef.current();
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(fire, limit);
    };
    const onActivity = () => {
      lastActivity = Date.now();
      schedule();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivity >= limit) fire();
      else schedule();
    };

    ACTIVITY_EVENTS.forEach((e) => document.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    schedule();

    return () => {
      window.clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((e) => document.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, timeoutMinutes]);
}
