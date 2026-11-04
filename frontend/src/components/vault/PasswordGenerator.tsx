/**
 * Password generator dialog.
 */

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_GENERATOR_OPTIONS, assessPassword, generatePassword, type GeneratorOptions } from '../../lib/passwords';
import { useClipboard } from '../../hooks/useClipboard';
import { Button, Checkbox, Modal } from '../ui/kit';

interface PasswordGeneratorProps {
  onSelect: (password: string) => void;
  onClose: () => void;
  /** Organization minimum length; the slider never goes below it. */
  minLength?: number;
}

export default function PasswordGenerator({ onSelect, onClose, minLength = 8 }: PasswordGeneratorProps) {
  const [options, setOptions] = useState<GeneratorOptions>(() => ({
    ...DEFAULT_GENERATOR_OPTIONS,
    length: Math.max(DEFAULT_GENERATOR_OPTIONS.length, minLength),
  }));
  const [password, setPassword] = useState('');
  const { copy, copiedKey } = useClipboard();

  const regenerate = useCallback(() => setPassword(generatePassword(options)), [options]);
  useEffect(regenerate, [regenerate]);

  const update = <K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]) => setOptions((prev) => ({ ...prev, [key]: value }));
  const strength = assessPassword(password);
  const noSets = !options.uppercase && !options.lowercase && !options.numbers && !options.symbols;

  return (
    <Modal
      title="Generate password"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!password}
            onClick={() => {
              onSelect(password);
              onClose();
            }}
          >
            Use password
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <code data-testid="generated-password" className="flex-1 break-all rounded-lg bg-gray-100 px-3 py-3 font-mono text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100">
            {password || 'Select at least one character type'}
          </code>
          <Button variant="secondary" size="sm" onClick={regenerate} aria-label="Generate new password">
            New
          </Button>
          <Button variant="secondary" size="sm" disabled={!password} onClick={() => void copy(password, 'generated')}>
            {copiedKey === 'generated' ? 'Copied' : 'Copy'}
          </Button>
        </div>

        {password && (
          <div>
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full ${i < strength.score ? strength.barClass : 'bg-gray-200 dark:bg-gray-700'}`} />
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {strength.label}, about {strength.entropyBits} bits
            </p>
          </div>
        )}

        <div>
          <label htmlFor="pw-length" className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300">
            <span>Length</span>
            <span>{options.length}</span>
          </label>
          <input
            id="pw-length"
            type="range"
            min={minLength}
            max={64}
            value={options.length}
            onChange={(e) => update('length', Number(e.target.value))}
            className="mt-2 w-full accent-vault-600"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Checkbox label="Uppercase (A-Z)" checked={options.uppercase} onChange={(e) => update('uppercase', e.target.checked)} />
          <Checkbox label="Lowercase (a-z)" checked={options.lowercase} onChange={(e) => update('lowercase', e.target.checked)} />
          <Checkbox label="Numbers (0-9)" checked={options.numbers} onChange={(e) => update('numbers', e.target.checked)} />
          <Checkbox label="Symbols (!@#...)" checked={options.symbols} onChange={(e) => update('symbols', e.target.checked)} />
        </div>
        <Checkbox
          label="Avoid look-alike characters"
          description="Leaves out I, l, 1, O, 0 and o"
          checked={options.excludeAmbiguous}
          onChange={(e) => update('excludeAmbiguous', e.target.checked)}
        />
        {noSets && <p className="text-sm text-red-600 dark:text-red-400">Select at least one character type.</p>}
      </div>
    </Modal>
  );
}
