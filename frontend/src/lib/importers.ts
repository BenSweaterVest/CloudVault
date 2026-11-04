/**
 * Import parsers and export formats.
 *
 * Everything runs in the browser. Imported items are encrypted before upload;
 * exports are either a passphrase-encrypted backup or (on explicit request)
 * a plain CSV.
 */

import type { SecretInput, SecretType } from './api';
import { base64ToBytes, bufferToBase64, deriveKeyFromPassword, randomBytes, type SecretPayload } from './crypto';

export interface ImportItem extends SecretInput {
  payload: SecretPayload;
}

export type ImportFormat = 'bitwarden_csv' | 'lastpass_csv' | 'generic_csv' | 'cloudvault_backup';

// ============================================
// CSV
// ============================================

/** RFC 4180 CSV parser. Values are not trimmed (passwords may have spaces). */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = content.replace(/^\uFEFF/, '');

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

function csvEscape(value: string | undefined): string {
  const v = value ?? '';
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function indexer(headerRow: string[]) {
  const headers = headerRow.map((h) => h.trim().toLowerCase());
  return (...names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
}

const at = (row: string[], i: number) => (i >= 0 && row[i] !== undefined && row[i] !== '' ? row[i] : undefined);

function cleanUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

function makeItem(fields: {
  name?: string;
  url?: string;
  username?: string;
  password?: string;
  notes?: string;
  totp?: string;
  folder?: string;
  type?: SecretType;
}): ImportItem {
  const type: SecretType = fields.type ?? (fields.password || fields.username ? 'password' : fields.notes ? 'note' : 'password');
  const tag = fields.folder?.trim();
  return {
    name: (fields.name?.trim() || cleanUrl(fields.url)?.replace(/^https?:\/\//, '').split('/')[0] || 'Untitled').slice(0, 200),
    url: cleanUrl(fields.url),
    usernameHint: fields.username?.slice(0, 200),
    secretType: type,
    tags: tag ? [tag.slice(0, 50)] : undefined,
    payload: { username: fields.username, password: fields.password, notes: fields.notes, totp: fields.totp },
  };
}

export function parseBitwardenCsv(content: string): ImportItem[] {
  const [header, ...rows] = parseCsv(content);
  if (!header) throw new Error('The file is empty');
  const col = indexer(header);
  const name = col('name');
  if (name < 0) throw new Error('This does not look like a Bitwarden export (no "name" column)');
  const type = col('type');
  return rows.map((r) =>
    makeItem({
      name: at(r, name),
      url: at(r, col('login_uri')),
      username: at(r, col('login_username')),
      password: at(r, col('login_password')),
      totp: at(r, col('login_totp')),
      notes: at(r, col('notes')),
      folder: at(r, col('folder')),
      type: at(r, type) === 'note' ? 'note' : undefined,
    })
  );
}

export function parseLastPassCsv(content: string): ImportItem[] {
  const [header, ...rows] = parseCsv(content);
  if (!header) throw new Error('The file is empty');
  const col = indexer(header);
  if (col('name') < 0 || col('url') < 0) throw new Error('This does not look like a LastPass export');
  return rows.map((r) => {
    const url = at(r, col('url'));
    return makeItem({
      name: at(r, col('name')),
      // LastPass marks secure notes with the placeholder URL http://sn
      url: url === 'http://sn' ? undefined : url,
      username: at(r, col('username')),
      password: at(r, col('password')),
      totp: at(r, col('totp')),
      notes: at(r, col('extra')),
      folder: at(r, col('grouping')),
      type: url === 'http://sn' ? 'note' : undefined,
    });
  });
}

export function parseGenericCsv(content: string): ImportItem[] {
  const [header, ...rows] = parseCsv(content);
  if (!header) throw new Error('The file is empty');
  const col = indexer(header);
  const name = col('name', 'title', 'site', 'service', 'account');
  if (name < 0) throw new Error('Could not find a name or title column');
  return rows.map((r) =>
    makeItem({
      name: at(r, name),
      url: at(r, col('url', 'website', 'login_uri', 'site_url', 'web site')),
      username: at(r, col('username', 'user', 'login', 'email', 'login_username', 'user name')),
      password: at(r, col('password', 'pass', 'login_password')),
      totp: at(r, col('totp', 'otp', 'login_totp', 'one-time password')),
      notes: at(r, col('notes', 'note', 'extra', 'comments')),
      folder: at(r, col('folder', 'group', 'category', 'grouping')),
    })
  );
}

/** Plain CSV in Bitwarden's import format (most managers accept it). */
export function toBitwardenCsv(items: ImportItem[]): string {
  const header = ['folder', 'favorite', 'type', 'name', 'notes', 'fields', 'reprompt', 'login_uri', 'login_username', 'login_password', 'login_totp'];
  const lines = items.map((i) =>
    [
      i.tags?.[0],
      '',
      i.secretType === 'note' ? 'note' : 'login',
      i.name,
      [i.payload.notes, ...(i.payload.customFields ?? []).map((f) => `${f.label}: ${f.value}`), i.payload.apiKey && `API key: ${i.payload.apiKey}`]
        .filter(Boolean)
        .join('\n'),
      '',
      '0',
      i.url ?? '',
      i.payload.username,
      i.payload.password,
      i.payload.totp,
    ]
      .map((v) => csvEscape(v ?? undefined))
      .join(',')
  );
  return [header.join(','), ...lines].join('\r\n');
}

// ============================================
// ENCRYPTED BACKUP
// ============================================

const BACKUP_ITERATIONS = 600_000;

interface BackupFile {
  format: 'cloudvault-backup';
  version: 1;
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  iv: string;
  ciphertext: string;
}

/**
 * Encrypt items under a passphrase. The file can be restored into any
 * CloudVault organization, independent of org keys.
 */
export async function createEncryptedBackup(items: ImportItem[], passphrase: string): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKeyFromPassword(passphrase, salt, BACKUP_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify({ exportedAt: new Date().toISOString(), items }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('cloudvault-backup-v1') }, key, plaintext);
  const file: BackupFile = {
    format: 'cloudvault-backup',
    version: 1,
    kdf: { name: 'PBKDF2-SHA256', iterations: BACKUP_ITERATIONS, salt: bufferToBase64(salt) },
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertext),
  };
  return JSON.stringify(file, null, 2);
}

export function isEncryptedBackup(content: string): boolean {
  try {
    return (JSON.parse(content) as Partial<BackupFile>).format === 'cloudvault-backup';
  } catch {
    return false;
  }
}

export async function readEncryptedBackup(content: string, passphrase: string): Promise<ImportItem[]> {
  let file: BackupFile;
  try {
    file = JSON.parse(content);
  } catch {
    throw new Error('This is not a CloudVault backup file');
  }
  if (file.format !== 'cloudvault-backup' || file.version !== 1) throw new Error('Unsupported backup format');
  const key = await deriveKeyFromPassword(passphrase, base64ToBytes(file.kdf.salt), file.kdf.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(file.iv), additionalData: new TextEncoder().encode('cloudvault-backup-v1') },
      key,
      base64ToBytes(file.ciphertext)
    );
  } catch {
    throw new Error('Wrong passphrase, or the file is damaged');
  }
  const data = JSON.parse(new TextDecoder().decode(plaintext)) as { items: ImportItem[] };
  if (!Array.isArray(data.items)) throw new Error('The backup has no items');
  return data.items;
}

export function parseImport(content: string, format: Exclude<ImportFormat, 'cloudvault_backup'>): ImportItem[] {
  const items = format === 'bitwarden_csv' ? parseBitwardenCsv(content) : format === 'lastpass_csv' ? parseLastPassCsv(content) : parseGenericCsv(content);
  if (items.length === 0) throw new Error('No items found in the file');
  return items;
}
