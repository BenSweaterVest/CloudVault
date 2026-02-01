/**
 * Keyboard Shortcuts Hook
 * 
 * Global keyboard shortcut handling.
 */

import { useEffect, useCallback } from 'react';

type KeyHandler = (event: KeyboardEvent) => void;

interface Shortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean; // Cmd on Mac
  shift?: boolean;
  alt?: boolean;
  handler: KeyHandler;
  description: string;
  when?: () => boolean; // Condition for when shortcut is active
}

interface UseKeyboardShortcutsOptions {
  shortcuts: Shortcut[];
  enabled?: boolean;
}

/**
 * Check if user is typing in an input field
 */
function isTyping(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) return false;
  
  const tagName = activeElement.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }
  
  if (activeElement.getAttribute('contenteditable') === 'true') {
    return true;
  }
  
  return false;
}

export function useKeyboardShortcuts({
  shortcuts,
  enabled = true,
}: UseKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;
      
      // Check each shortcut
      for (const shortcut of shortcuts) {
        const key = shortcut.key.toLowerCase();
        const pressedKey = event.key.toLowerCase();
        
        // Check modifier keys
        const ctrlOrMeta = shortcut.ctrl || shortcut.meta;
        const hasCtrlOrMeta = event.ctrlKey || event.metaKey;
        
        if (ctrlOrMeta && !hasCtrlOrMeta) continue;
        if (!ctrlOrMeta && hasCtrlOrMeta) continue;
        if (shortcut.shift && !event.shiftKey) continue;
        if (!shortcut.shift && event.shiftKey) continue;
        if (shortcut.alt && !event.altKey) continue;
        if (!shortcut.alt && event.altKey) continue;
        
        // Check key
        if (pressedKey !== key) continue;
        
        // Check condition
        if (shortcut.when && !shortcut.when()) continue;
        
        // Don't trigger if typing (unless it's Escape)
        if (isTyping() && key !== 'escape') continue;
        
        // Match! Execute handler
        event.preventDefault();
        shortcut.handler(event);
        return;
      }
    },
    [shortcuts, enabled]
  );

  useEffect(() => {
    if (!enabled) return;
    
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown, enabled]);
}

/**
 * Format shortcut for display
 */
export function formatShortcut(shortcut: Pick<Shortcut, 'key' | 'ctrl' | 'meta' | 'shift' | 'alt'>): string {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const parts: string[] = [];
  
  if (shortcut.ctrl || shortcut.meta) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (shortcut.shift) {
    parts.push(isMac ? '⇧' : 'Shift');
  }
  if (shortcut.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }
  
  // Format key
  let key = shortcut.key.toUpperCase();
  if (key === 'ESCAPE') key = 'Esc';
  if (key === ' ') key = 'Space';
  parts.push(key);
  
  return parts.join(isMac ? '' : '+');
}

/**
 * Predefined shortcuts for the app
 */
export const APP_SHORTCUTS = {
  search: { key: 'k', meta: true, description: 'Quick search' },
  newSecret: { key: 'n', meta: true, description: 'New secret' },
  lock: { key: 'l', meta: true, shift: true, description: 'Lock vault' },
  escape: { key: 'Escape', description: 'Close modal / Cancel' },
} as const;
