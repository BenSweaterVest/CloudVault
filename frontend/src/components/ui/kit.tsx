/**
 * Small shared UI primitives so screens stay consistent (and dark-mode
 * aware) without repeating long Tailwind class lists.
 */

import { forwardRef, useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { FocusTrap } from './Accessibility';

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

// ============================================
// BUTTONS
// ============================================

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-vault-600 text-white hover:bg-vault-700 disabled:hover:bg-vault-600',
  secondary:
    'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:hover:bg-red-600',
  ghost: 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
}

export function Button({ variant = 'primary', size = 'md', loading, disabled, className, children, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm',
        BUTTON_VARIANTS[variant],
        className
      )}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-vault-600" role="status" aria-label="Loading">
      <Spinner className="h-10 w-10" />
    </div>
  );
}

// ============================================
// FORM FIELDS
// ============================================

const INPUT_CLASSES =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-vault-500 focus:outline-none focus:ring-1 focus:ring-vault-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500';

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...props }, ref) {
  return <input ref={ref} className={cx(INPUT_CLASSES, className)} {...props} />;
});

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(INPUT_CLASSES, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(INPUT_CLASSES, className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ label, description, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300 text-vault-600 focus:ring-vault-500" {...props} />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-gray-800 dark:text-gray-200">{label}</span>
        {description && <span className="block text-gray-500 dark:text-gray-400">{description}</span>}
      </label>
    </div>
  );
}

// ============================================
// LAYOUT
// ============================================

export function Card({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>}
            {description && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
        {description && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Centered single-card screen for login, setup, unlock and public pages. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 dark:bg-gray-900">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <LockIcon className="mx-auto h-14 w-14 text-vault-600" />
          <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">{children}</div>
      </div>
    </div>
  );
}

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="16" r="1" />
    </svg>
  );
}

// ============================================
// FEEDBACK
// ============================================

const ALERT_STYLES = {
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  info: 'border-vault-200 bg-vault-50 text-vault-900 dark:border-vault-800 dark:bg-vault-900/30 dark:text-vault-100',
  success: 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-200',
};

export function Alert({ tone = 'info', title, children }: { tone?: keyof typeof ALERT_STYLES; title?: string; children?: ReactNode }) {
  return (
    <div className={cx('rounded-lg border px-4 py-3 text-sm', ALERT_STYLES[tone])} role={tone === 'error' ? 'alert' : 'status'}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1' : undefined}>{children}</div>}
    </div>
  );
}

const BADGE_STYLES = {
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  blue: 'bg-vault-100 text-vault-800 dark:bg-vault-900/50 dark:text-vault-200',
  green: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200',
};

export function Badge({ color = 'gray', children }: { color?: keyof typeof BADGE_STYLES; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', BADGE_STYLES[color])}>{children}</span>;
}

/** Key fingerprint, formatted for reading aloud. */
export function Fingerprint({ value }: { value: string | null }) {
  return (
    <code className="inline-block rounded bg-gray-100 px-2 py-1 font-mono text-sm tracking-wide text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      {value ?? 'computing...'}
    </code>
  );
}

// ============================================
// MODAL
// ============================================

export function Modal({ title, onClose, children, footer, size = 'md' }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' }) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
        <FocusTrap>
          <div className={cx('relative w-full rounded-xl bg-white shadow-xl animate-scale-in dark:bg-gray-800', size === 'lg' ? 'max-w-2xl' : 'max-w-lg')}>
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
              <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">
                {title}
              </h2>
              <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Close">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-6 py-4">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-6 py-4 dark:border-gray-700">{footer}</div>}
          </div>
        </FocusTrap>
      </div>
    </div>
  );
}

/** Message from an unknown thrown value. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
