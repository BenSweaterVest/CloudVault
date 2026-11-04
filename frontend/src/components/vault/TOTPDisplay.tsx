/**
 * Live TOTP code with countdown and copy.
 */

import { useEffect, useMemo, useState } from 'react';
import { generateTotp, parseTotp } from '../../lib/totp';
import { useClipboard } from '../../hooks/useClipboard';
import { Button } from '../ui/kit';

export default function TOTPDisplay({ value }: { value: string }) {
  const config = useMemo(() => parseTotp(value), [value]);
  const [code, setCode] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(30);
  const { copy, copiedKey } = useClipboard();

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    const tick = () => {
      generateTotp(config)
        .then((r) => {
          if (cancelled) return;
          setCode(r.code);
          setRemaining(r.remaining);
        })
        .catch(() => !cancelled && setCode(null));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [config]);

  if (!config) {
    return <p className="text-sm text-red-600 dark:text-red-400">The saved 2FA secret is not a valid TOTP secret or otpauth:// link.</p>;
  }

  const formatted = code ? `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}` : '--- ---';
  const low = remaining <= 5;

  return (
    <div className="flex items-center gap-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex-1">
        {(config.issuer || config.accountName) && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{[config.issuer, config.accountName].filter(Boolean).join(' / ')}</p>
        )}
        <p className={`font-mono text-2xl font-semibold tracking-widest ${low ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`} aria-live="polite">
          {formatted}
        </p>
        <div className="mt-2 h-1 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700" aria-hidden="true">
          <div className={`h-full ${low ? 'bg-red-500' : 'bg-vault-500'}`} style={{ width: `${(remaining / config.period) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Changes in {remaining}s</p>
      </div>
      <Button variant="secondary" size="sm" disabled={!code} onClick={() => code && void copy(code, 'totp')}>
        {copiedKey === 'totp' ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
