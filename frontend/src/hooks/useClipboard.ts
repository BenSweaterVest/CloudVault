/**
 * Clipboard Hook with Auto-Clear
 * 
 * Copies text to clipboard and optionally clears it after a delay.
 */

import { useState, useCallback, useRef } from 'react';

interface UseClipboardOptions {
  clearAfterSeconds?: number; // 0 = disabled
  onCopy?: () => void;
  onClear?: () => void;
}

interface UseClipboardReturn {
  copied: boolean;
  copy: (text: string) => Promise<void>;
  clear: () => void;
}

export function useClipboard({
  clearAfterSeconds = 30,
  onCopy,
  onClear,
}: UseClipboardOptions = {}): UseClipboardReturn {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const lastCopiedRef = useRef<string>('');

  const clear = useCallback(async () => {
    try {
      // Only clear if the clipboard still contains what we copied
      const currentClipboard = await navigator.clipboard.readText();
      if (currentClipboard === lastCopiedRef.current) {
        await navigator.clipboard.writeText('');
        onClear?.();
      }
    } catch {
      // Clipboard API might fail if page is not focused
      // Just clear our state
    }
    
    setCopied(false);
    lastCopiedRef.current = '';
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [onClear]);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      lastCopiedRef.current = text;
      setCopied(true);
      onCopy?.();

      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set up auto-clear
      if (clearAfterSeconds > 0) {
        timeoutRef.current = window.setTimeout(() => {
          clear();
        }, clearAfterSeconds * 1000);
      }

      // Reset copied state after 2 seconds (for UI feedback)
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      throw err;
    }
  }, [clearAfterSeconds, clear, onCopy]);

  return { copied, copy, clear };
}

/**
 * Format remaining time for display
 */
export function formatClearTime(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}
