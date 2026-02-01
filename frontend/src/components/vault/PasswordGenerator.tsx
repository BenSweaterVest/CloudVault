/**
 * Password Generator Component
 * 
 * Configurable secure password generation.
 */

import { useState, useCallback, useMemo } from 'react';

interface PasswordGeneratorProps {
  onSelect: (password: string) => void;
  onClose: () => void;
}

interface GeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
  customSymbols: string;
}

const CHAR_SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  uppercaseUnambiguous: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // No I, O
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  lowercaseUnambiguous: 'abcdefghjkmnpqrstuvwxyz', // No i, l, o
  numbers: '0123456789',
  numbersUnambiguous: '23456789', // No 0, 1
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
};

export default function PasswordGenerator({ onSelect, onClose }: PasswordGeneratorProps) {
  const [options, setOptions] = useState<GeneratorOptions>({
    length: 20,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    excludeAmbiguous: false,
    customSymbols: '',
  });
  
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const charset = useMemo(() => {
    let chars = '';
    
    if (options.uppercase) {
      chars += options.excludeAmbiguous ? CHAR_SETS.uppercaseUnambiguous : CHAR_SETS.uppercase;
    }
    if (options.lowercase) {
      chars += options.excludeAmbiguous ? CHAR_SETS.lowercaseUnambiguous : CHAR_SETS.lowercase;
    }
    if (options.numbers) {
      chars += options.excludeAmbiguous ? CHAR_SETS.numbersUnambiguous : CHAR_SETS.numbers;
    }
    if (options.symbols) {
      chars += options.customSymbols || CHAR_SETS.symbols;
    }
    
    return chars;
  }, [options]);

  const generatePassword = useCallback(() => {
    if (charset.length === 0) {
      setGeneratedPassword('');
      return;
    }
    
    const randomValues = new Uint32Array(options.length);
    crypto.getRandomValues(randomValues);
    
    let password = '';
    for (let i = 0; i < options.length; i++) {
      password += charset[randomValues[i] % charset.length];
    }
    
    // Ensure at least one of each selected type
    const checks = [
      { enabled: options.uppercase, regex: /[A-Z]/, set: options.excludeAmbiguous ? CHAR_SETS.uppercaseUnambiguous : CHAR_SETS.uppercase },
      { enabled: options.lowercase, regex: /[a-z]/, set: options.excludeAmbiguous ? CHAR_SETS.lowercaseUnambiguous : CHAR_SETS.lowercase },
      { enabled: options.numbers, regex: /[0-9]/, set: options.excludeAmbiguous ? CHAR_SETS.numbersUnambiguous : CHAR_SETS.numbers },
      { enabled: options.symbols, regex: /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/, set: options.customSymbols || CHAR_SETS.symbols },
    ];
    
    for (const check of checks) {
      if (check.enabled && !check.regex.test(password)) {
        // Replace a random position with a character from the missing set
        const pos = Math.floor(Math.random() * password.length);
        const randomChar = check.set[Math.floor(Math.random() * check.set.length)];
        password = password.slice(0, pos) + randomChar + password.slice(pos + 1);
      }
    }
    
    setGeneratedPassword(password);
    setCopied(false);
  }, [charset, options]);

  // Generate initial password on mount
  useEffect(() => {
    generatePassword();
  }, []);

  const copyToClipboard = async () => {
    if (!generatedPassword) return;
    try {
      await navigator.clipboard.writeText(generatedPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleUse = () => {
    if (generatedPassword) {
      onSelect(generatedPassword);
      onClose();
    }
  };

  const updateOption = <K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  // Calculate password strength
  const strength = useMemo(() => {
    const len = options.length;
    const charsetLen = charset.length;
    
    if (charsetLen === 0) return { score: 0, label: 'Invalid', color: 'bg-gray-300' };
    
    // Entropy bits = log2(charset^length)
    const entropy = Math.log2(Math.pow(charsetLen, len));
    
    if (entropy < 40) return { score: 1, label: 'Weak', color: 'bg-red-500' };
    if (entropy < 60) return { score: 2, label: 'Fair', color: 'bg-orange-500' };
    if (entropy < 80) return { score: 3, label: 'Good', color: 'bg-yellow-500' };
    if (entropy < 100) return { score: 4, label: 'Strong', color: 'bg-green-500' };
    return { score: 5, label: 'Very Strong', color: 'bg-green-600' };
  }, [options.length, charset.length]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-30" onClick={onClose} />
        
        <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
            Generate Password
          </h2>

          {/* Generated Password Display */}
          <div className="mb-6">
            <div className="flex items-center gap-2 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <code className="flex-1 text-lg font-mono break-all text-gray-900 dark:text-gray-100">
                {generatedPassword || 'Select at least one option'}
              </code>
              <button
                onClick={copyToClipboard}
                className={`p-2 rounded transition-colors ${
                  copied
                    ? 'text-green-600 bg-green-100 dark:bg-green-900/30'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                title="Copy to clipboard"
              >
                {copied ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                )}
              </button>
              <button
                onClick={generatePassword}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                title="Regenerate"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
            
            {/* Strength Indicator */}
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${strength.color}`}
                  style={{ width: `${(strength.score / 5) * 100}%` }}
                />
              </div>
              <span className="text-sm text-gray-600 dark:text-gray-400">{strength.label}</span>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-4">
            {/* Length */}
            <div>
              <label className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300 mb-2">
                <span>Length</span>
                <span className="font-medium">{options.length}</span>
              </label>
              <input
                type="range"
                min="8"
                max="64"
                value={options.length}
                onChange={(e) => {
                  updateOption('length', parseInt(e.target.value));
                  setTimeout(generatePassword, 0);
                }}
                className="w-full"
              />
            </div>

            {/* Character Options */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'uppercase' as const, label: 'Uppercase (A-Z)' },
                { key: 'lowercase' as const, label: 'Lowercase (a-z)' },
                { key: 'numbers' as const, label: 'Numbers (0-9)' },
                { key: 'symbols' as const, label: 'Symbols (!@#...)' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={(e) => {
                      updateOption(key, e.target.checked);
                      setTimeout(generatePassword, 0);
                    }}
                    className="rounded border-gray-300 text-vault-600 focus:ring-vault-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                </label>
              ))}
            </div>

            {/* Advanced Options */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={options.excludeAmbiguous}
                onChange={(e) => {
                  updateOption('excludeAmbiguous', e.target.checked);
                  setTimeout(generatePassword, 0);
                }}
                className="rounded border-gray-300 text-vault-600 focus:ring-vault-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Exclude ambiguous (0, O, I, l, 1)
              </span>
            </label>
          </div>

          {/* Actions */}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleUse}
              disabled={!generatedPassword}
              className="px-4 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Use Password
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
