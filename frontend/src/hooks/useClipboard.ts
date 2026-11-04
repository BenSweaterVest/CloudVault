/**
 * Copy to clipboard with automatic clearing.
 *
 * The clear delay defaults to the user's "clear clipboard" preference. When
 * the timer fires, the clipboard is cleared if it still holds what we copied.
 * If the browser will not let us read the clipboard to check, it is cleared
 * anyway: leaving a password behind is worse than clearing something newer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePreferences } from '../lib/preferences';

interface UseClipboardOptions {
  /** Seconds before clearing. Defaults to the user preference. 0 disables. */
  clearAfterSeconds?: number;
}

interface UseClipboardReturn {
  /** Key of the most recently copied item, for "Copied" feedback (2 s). */
  copiedKey: string | null;
  copy: (text: string, key?: string) => Promise<boolean>;
  clearAfterSeconds: number;
}

/** Pending clear shared by every hook instance, so the latest copy wins. */
let pendingClear: { timer: number; text: string } | null = null;

async function clearIfUnchanged(text: string) {
  try {
    const current = await navigator.clipboard.readText();
    if (current !== text) return;
  } catch {
    // Cannot read (permission or focus): clear anyway.
  }
  try {
    await navigator.clipboard.writeText('');
  } catch {
    // Page not focused; nothing more we can do.
  }
}

export function useClipboard(options: UseClipboardOptions = {}): UseClipboardReturn {
  const { preferences } = usePreferences();
  const clearAfterSeconds = options.clearAfterSeconds ?? preferences.clipboardClear;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const feedbackTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    },
    []
  );

  const copy = useCallback(
    async (text: string, key = 'default') => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }

      setCopiedKey(key);
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
      feedbackTimer.current = window.setTimeout(() => setCopiedKey(null), 2000);

      if (pendingClear) window.clearTimeout(pendingClear.timer);
      pendingClear = null;
      if (clearAfterSeconds > 0) {
        const timer = window.setTimeout(() => {
          pendingClear = null;
          void clearIfUnchanged(text);
        }, clearAfterSeconds * 1000);
        pendingClear = { timer, text };
      }
      return true;
    },
    [clearAfterSeconds]
  );

  return { copiedKey, copy, clearAfterSeconds };
}

export function formatClearTime(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}
