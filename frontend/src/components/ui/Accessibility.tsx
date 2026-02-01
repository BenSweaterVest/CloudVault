/**
 * Accessibility Components and Utilities
 * 
 * Provides WCAG 2.1 AA compliant accessibility features.
 */

import { useEffect, useRef, type ReactNode } from 'react';

// ============================================
// SKIP LINK
// ============================================

interface SkipLinkProps {
  targetId: string;
  children?: ReactNode;
}

export function SkipLink({ targetId, children = 'Skip to main content' }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-vault-600 focus:text-white focus:rounded-lg focus:shadow-lg"
    >
      {children}
    </a>
  );
}

// ============================================
// SCREEN READER ANNOUNCER
// ============================================

let announceElement: HTMLDivElement | null = null;

export function announce(message: string, priority: 'polite' | 'assertive' = 'polite') {
  if (typeof document === 'undefined') return;
  
  if (!announceElement) {
    announceElement = document.createElement('div');
    announceElement.setAttribute('role', 'status');
    announceElement.setAttribute('aria-live', priority);
    announceElement.setAttribute('aria-atomic', 'true');
    announceElement.className = 'sr-only';
    document.body.appendChild(announceElement);
  }
  
  // Clear and re-announce to trigger screen reader
  announceElement.textContent = '';
  announceElement.setAttribute('aria-live', priority);
  
  requestAnimationFrame(() => {
    if (announceElement) {
      announceElement.textContent = message;
    }
  });
}

// ============================================
// FOCUS TRAP
// ============================================

interface FocusTrapProps {
  children: ReactNode;
  active?: boolean;
  returnFocusOnDeactivate?: boolean;
}

export function FocusTrap({
  children,
  active = true,
  returnFocusOnDeactivate = true,
}: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!active) return;
    
    previousActiveElementRef.current = document.activeElement;
    
    // Focus first focusable element
    const container = containerRef.current;
    if (container) {
      const firstFocusable = container.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
    }
    
    return () => {
      if (returnFocusOnDeactivate && previousActiveElementRef.current instanceof HTMLElement) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [active, returnFocusOnDeactivate]);

  useEffect(() => {
    if (!active) return;
    
    const container = containerRef.current;
    if (!container) return;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      
      const focusableElements = container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
      );
      
      if (focusableElements.length === 0) return;
      
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      
      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };
    
    container.addEventListener('keydown', handleKeyDown);
    
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [active]);

  return (
    <div ref={containerRef} tabIndex={-1}>
      {children}
    </div>
  );
}

// ============================================
// VISUALLY HIDDEN
// ============================================

interface VisuallyHiddenProps {
  children: ReactNode;
  as?: 'span' | 'div';
}

export function VisuallyHidden({ children, as: Component = 'span' }: VisuallyHiddenProps) {
  return <Component className="sr-only">{children}</Component>;
}

// ============================================
// LIVE REGION
// ============================================

interface LiveRegionProps {
  children: ReactNode;
  'aria-live'?: 'polite' | 'assertive' | 'off';
  'aria-atomic'?: boolean;
}

export function LiveRegion({
  children,
  'aria-live': ariaLive = 'polite',
  'aria-atomic': ariaAtomic = true,
}: LiveRegionProps) {
  return (
    <div
      role="status"
      aria-live={ariaLive}
      aria-atomic={ariaAtomic}
      className="sr-only"
    >
      {children}
    </div>
  );
}

// ============================================
// FOCUS RING HOOK
// ============================================

export function useFocusRing() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        document.body.classList.add('keyboard-navigation');
      }
    };
    
    const handleMouseDown = () => {
      document.body.classList.remove('keyboard-navigation');
    };
    
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);
}

// ============================================
// ACCESSIBLE ICON BUTTON
// ============================================

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function IconButton({ label, children, className = '', ...props }: IconButtonProps) {
  return (
    <button
      {...props}
      aria-label={label}
      className={`inline-flex items-center justify-center ${className}`}
    >
      {children}
      <VisuallyHidden>{label}</VisuallyHidden>
    </button>
  );
}
