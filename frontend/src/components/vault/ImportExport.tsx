/**
 * Import/Export Page Component
 * 
 * Handles importing from other password managers and exporting backups.
 * Works as a standalone page using vault context.
 * 
 * @module components/vault/ImportExport
 */

import { useState, useRef } from 'react';
import { useVault } from '../../hooks/useVault';
import { useToast } from '../ui/Toast';
import { encryptSecret } from '../../lib/crypto';

type ImportFormat = 'bitwarden_csv' | 'lastpass_csv' | 'generic_csv' | 'cloudvault_json';
type ExportFormat = 'cloudvault_json' | 'csv_names';

interface ImportedSecret {
  name: string;
  url?: string;
  username?: string;
  password?: string;
  notes?: string;
  type?: string;
}

const API_BASE = '/api';

export default function ImportExport() {
  const { currentOrg, getOrgKey, loadSecrets } = useVault();
  const { success, error } = useToast();
  
  const [activeTab, setActiveTab] = useState<'import' | 'export'>('import');
  const [importFormat, setImportFormat] = useState<ImportFormat>('bitwarden_csv');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('cloudvault_json');
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedSecrets, setParsedSecrets] = useState<ImportedSecret[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const secrets = parseImportFile(text, importFormat);
      setParsedSecrets(secrets);
      setShowPreview(true);
    } catch (err) {
      error('Parse Error', (err as Error).message);
    }
  };

  const parseImportFile = (content: string, format: ImportFormat): ImportedSecret[] => {
    switch (format) {
      case 'bitwarden_csv':
        return parseBitwardenCSV(content);
      case 'lastpass_csv':
        return parseLastPassCSV(content);
      case 'generic_csv':
        return parseGenericCSV(content);
      case 'cloudvault_json':
        return parseCloudVaultJSON(content);
      default:
        throw new Error('Unsupported format');
    }
  };

  const parseBitwardenCSV = (content: string): ImportedSecret[] => {
    const lines = parseCSVLines(content);
    if (lines.length < 2) throw new Error('Invalid CSV file');
    
    const headers = lines[0].map(h => h.toLowerCase());
    const nameIdx = headers.indexOf('name');
    const urlIdx = headers.indexOf('login_uri');
    const usernameIdx = headers.indexOf('login_username');
    const passwordIdx = headers.indexOf('login_password');
    const notesIdx = headers.indexOf('notes');
    
    if (nameIdx === -1) throw new Error('Missing required "name" column');
    
    return lines.slice(1).map(row => ({
      name: row[nameIdx] || 'Unnamed',
      url: row[urlIdx] || undefined,
      username: row[usernameIdx] || undefined,
      password: row[passwordIdx] || undefined,
      notes: row[notesIdx] || undefined,
    })).filter(s => s.name);
  };

  const parseLastPassCSV = (content: string): ImportedSecret[] => {
    const lines = parseCSVLines(content);
    if (lines.length < 2) throw new Error('Invalid CSV file');
    
    const headers = lines[0].map(h => h.toLowerCase());
    const nameIdx = headers.indexOf('name');
    const urlIdx = headers.indexOf('url');
    const usernameIdx = headers.indexOf('username');
    const passwordIdx = headers.indexOf('password');
    const notesIdx = headers.indexOf('extra');
    
    if (nameIdx === -1) throw new Error('Missing required "name" column');
    
    return lines.slice(1).map(row => ({
      name: row[nameIdx] || 'Unnamed',
      url: row[urlIdx] || undefined,
      username: row[usernameIdx] || undefined,
      password: row[passwordIdx] || undefined,
      notes: row[notesIdx] || undefined,
    })).filter(s => s.name);
  };

  const parseGenericCSV = (content: string): ImportedSecret[] => {
    const lines = parseCSVLines(content);
    if (lines.length < 2) throw new Error('Invalid CSV file');
    
    const headers = lines[0].map(h => h.toLowerCase());
    
    const nameIdx = findColumnIndex(headers, ['name', 'title', 'site', 'service']);
    const urlIdx = findColumnIndex(headers, ['url', 'website', 'site_url', 'login_uri']);
    const usernameIdx = findColumnIndex(headers, ['username', 'user', 'email', 'login']);
    const passwordIdx = findColumnIndex(headers, ['password', 'pass', 'secret']);
    const notesIdx = findColumnIndex(headers, ['notes', 'note', 'extra', 'comments']);
    
    if (nameIdx === -1) throw new Error('Could not find a name/title column');
    
    return lines.slice(1).map(row => ({
      name: row[nameIdx] || 'Unnamed',
      url: urlIdx >= 0 ? row[urlIdx] : undefined,
      username: usernameIdx >= 0 ? row[usernameIdx] : undefined,
      password: passwordIdx >= 0 ? row[passwordIdx] : undefined,
      notes: notesIdx >= 0 ? row[notesIdx] : undefined,
    })).filter(s => s.name);
  };

  const parseCloudVaultJSON = (content: string): ImportedSecret[] => {
    try {
      const data = JSON.parse(content);
      if (!Array.isArray(data.secrets)) throw new Error('Invalid CloudVault backup');
      return data.secrets;
    } catch {
      throw new Error('Invalid JSON format');
    }
  };

  const findColumnIndex = (headers: string[], candidates: string[]): number => {
    for (const candidate of candidates) {
      const idx = headers.indexOf(candidate);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const parseCSVLines = (content: string): string[][] => {
    const lines: string[][] = [];
    let currentLine: string[] = [];
    let currentField = '';
    let inQuotes = false;
    
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];
      
      if (inQuotes) {
        if (char === '"' && nextChar === '"') {
          currentField += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          currentField += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          currentLine.push(currentField.trim());
          currentField = '';
        } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
          currentLine.push(currentField.trim());
          if (currentLine.some(f => f)) {
            lines.push(currentLine);
          }
          currentLine = [];
          currentField = '';
          if (char === '\r') i++;
        } else {
          currentField += char;
        }
      }
    }
    
    if (currentField || currentLine.length > 0) {
      currentLine.push(currentField.trim());
      if (currentLine.some(f => f)) {
        lines.push(currentLine);
      }
    }
    
    return lines;
  };

  const handleImport = async () => {
    if (!currentOrg || parsedSecrets.length === 0) return;
    
    const orgKey = getOrgKey();
    if (!orgKey) {
      error('Error', 'Vault is locked');
      return;
    }
    
    setIsProcessing(true);
    setImportProgress({ current: 0, total: parsedSecrets.length });
    
    try {
      // Encrypt each secret and prepare for import
      const encryptedSecrets = [];
      
      for (let i = 0; i < parsedSecrets.length; i++) {
        const secret = parsedSecrets[i];
        setImportProgress({ current: i + 1, total: parsedSecrets.length });
        
        // Encrypt the secret data
        const { ciphertext, iv } = await encryptSecret(
          {
            username: secret.username || '',
            password: secret.password || '',
            notes: secret.notes || '',
          },
          orgKey
        );
        
        encryptedSecrets.push({
          name: secret.name,
          url: secret.url,
          usernameHint: secret.username?.substring(0, 50),
          ciphertextBlob: ciphertext,
          iv,
          secretType: secret.type || 'password',
        });
      }
      
      // Send to API
      const token = localStorage.getItem('cloudvault_token');
      const response = await fetch(`${API_BASE}/organizations/${currentOrg.id}/secrets/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ secrets: encryptedSecrets }),
      });
      
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Import failed');
      }
      
      const result = await response.json();
      
      // Refresh secrets list
      await loadSecrets();
      
      success('Import Complete', `Imported ${result.imported} secrets`);
      setParsedSecrets([]);
      setShowPreview(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      error('Import Failed', (err as Error).message);
    } finally {
      setIsProcessing(false);
      setImportProgress({ current: 0, total: 0 });
    }
  };

  const handleExport = async () => {
    if (!currentOrg) return;
    
    setIsProcessing(true);
    try {
      const token = localStorage.getItem('cloudvault_token');
      const response = await fetch(`${API_BASE}/organizations/${currentOrg.id}/secrets/export`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Export failed');
      }
      
      const data = await response.json();
      
      let content: string;
      let filename: string;
      let mimeType: string;
      
      if (exportFormat === 'cloudvault_json') {
        content = JSON.stringify(data, null, 2);
        filename = `cloudvault-backup-${new Date().toISOString().split('T')[0]}.json`;
        mimeType = 'application/json';
      } else {
        // CSV with names only (no passwords for security)
        const lines = ['Name,URL,Type,Tags,Created'];
        for (const secret of data.secrets) {
          lines.push([
            `"${secret.name.replace(/"/g, '""')}"`,
            `"${(secret.url || '').replace(/"/g, '""')}"`,
            secret.secretType,
            `"${(secret.tags || []).join(', ')}"`,
            secret.createdAt,
          ].join(','));
        }
        content = lines.join('\n');
        filename = `cloudvault-list-${new Date().toISOString().split('T')[0]}.csv`;
        mimeType = 'text/csv';
      }
      
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      
      success('Export Complete', `Exported ${data.secrets.length} secrets`);
    } catch (err) {
      error('Export Failed', (err as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!currentOrg) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">Please select an organization first.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Import / Export
      </h1>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
        <button
          onClick={() => setActiveTab('import')}
          className={`px-4 py-2 font-medium text-sm border-b-2 -mb-px ${
            activeTab === 'import'
              ? 'border-vault-600 text-vault-600 dark:text-vault-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
          }`}
        >
          Import
        </button>
        <button
          onClick={() => setActiveTab('export')}
          className={`px-4 py-2 font-medium text-sm border-b-2 -mb-px ${
            activeTab === 'export'
              ? 'border-vault-600 text-vault-600 dark:text-vault-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
          }`}
        >
          Export
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        {activeTab === 'import' ? (
          <div className="space-y-4">
            {!showPreview ? (
              <>
                {/* Format Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Import Format
                  </label>
                  <select
                    value={importFormat}
                    onChange={(e) => setImportFormat(e.target.value as ImportFormat)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-vault-500"
                  >
                    <option value="bitwarden_csv">Bitwarden (CSV)</option>
                    <option value="lastpass_csv">LastPass (CSV)</option>
                    <option value="generic_csv">Generic CSV</option>
                    <option value="cloudvault_json">CloudVault Backup (JSON)</option>
                  </select>
                </div>

                {/* File Upload */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Select File
                  </label>
                  <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.json"
                      onChange={handleFileSelect}
                      className="hidden"
                      id="import-file"
                    />
                    <label
                      htmlFor="import-file"
                      className="cursor-pointer"
                    >
                      <svg className="mx-auto w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                        Click to select a file or drag and drop
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        CSV or JSON up to 10MB
                      </p>
                    </label>
                  </div>
                </div>

                {/* Format Help */}
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400">
                  <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">How to export from other password managers:</h4>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>Bitwarden:</strong> Tools → Export Vault → CSV</li>
                    <li><strong>LastPass:</strong> Account Options → Advanced → Export</li>
                    <li><strong>1Password:</strong> File → Export → CSV (requires desktop app)</li>
                  </ul>
                </div>
              </>
            ) : (
              /* Import Preview */
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">
                    Preview ({parsedSecrets.length} secrets)
                  </h3>
                  <button
                    onClick={() => {
                      setShowPreview(false);
                      setParsedSecrets([]);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                  >
                    Cancel
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Name</th>
                        <th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">URL</th>
                        <th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Username</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                      {parsedSecrets.slice(0, 50).map((secret, i) => (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-3 py-2 text-gray-900 dark:text-gray-100 truncate max-w-[150px]">
                            {secret.name}
                          </td>
                          <td className="px-3 py-2 text-gray-500 dark:text-gray-400 truncate max-w-[150px]">
                            {secret.url || '-'}
                          </td>
                          <td className="px-3 py-2 text-gray-500 dark:text-gray-400 truncate max-w-[100px]">
                            {secret.username || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsedSecrets.length > 50 && (
                    <p className="text-center py-2 text-sm text-gray-500 dark:text-gray-400">
                      ... and {parsedSecrets.length - 50} more
                    </p>
                  )}
                </div>

                {/* Import Progress */}
                {isProcessing && importProgress.total > 0 && (
                  <div className="mt-4">
                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                      <span>Encrypting and importing...</span>
                      <span>{importProgress.current} / {importProgress.total}</span>
                    </div>
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-vault-600 transition-all"
                        style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                <button
                  onClick={handleImport}
                  disabled={isProcessing}
                  className="w-full mt-4 px-4 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700 disabled:opacity-50"
                >
                  {isProcessing ? 'Importing...' : `Import ${parsedSecrets.length} Secrets`}
                </button>
              </>
            )}
          </div>
        ) : (
          /* Export Tab */
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Export Format
              </label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-vault-500"
              >
                <option value="cloudvault_json">CloudVault Backup (JSON) - Encrypted</option>
                <option value="csv_names">CSV List (Names only, no passwords)</option>
              </select>
            </div>

            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 text-sm">
              <p className="text-yellow-800 dark:text-yellow-200">
                <strong>Security Note:</strong> The JSON export contains encrypted data that can only be
                decrypted with your organization key. The CSV export contains only names and URLs for
                reference purposes.
              </p>
            </div>

            <button
              onClick={handleExport}
              disabled={isProcessing}
              className="w-full px-4 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700 disabled:opacity-50"
            >
              {isProcessing ? 'Exporting...' : 'Download Export'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
