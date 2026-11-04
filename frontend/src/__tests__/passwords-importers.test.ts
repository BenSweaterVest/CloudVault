// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_GENERATOR_OPTIONS, assessPassword, generatePassword, randomInt } from '../lib/passwords';
import {
  createEncryptedBackup,
  isEncryptedBackup,
  parseBitwardenCsv,
  parseCsv,
  parseGenericCsv,
  parseLastPassCsv,
  readEncryptedBackup,
  toBitwardenCsv,
} from '../lib/importers';

describe('password generator', () => {
  it('honours length and includes every enabled character set', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword({ ...DEFAULT_GENERATOR_OPTIONS, length: 12 });
      expect(pw).toHaveLength(12);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it('excludes ambiguous characters and handles no sets', () => {
    for (let i = 0; i < 20; i++) {
      expect(generatePassword({ ...DEFAULT_GENERATOR_OPTIONS, length: 64, excludeAmbiguous: true })).not.toMatch(/[Il1O0o]/);
    }
    expect(generatePassword({ ...DEFAULT_GENERATOR_OPTIONS, uppercase: false, lowercase: false, numbers: false, symbols: false })).toBe('');
    expect(generatePassword({ ...DEFAULT_GENERATOR_OPTIONS, symbols: false, uppercase: false, numbers: false })).toMatch(/^[a-z]+$/);
  });

  it('draws integers uniformly within range', () => {
    const counts = new Array(3).fill(0);
    for (let i = 0; i < 3000; i++) counts[randomInt(3)]++;
    for (const c of counts) expect(c).toBeGreaterThan(800);
    expect(() => randomInt(0)).toThrow();
  });

  it('rates passwords sensibly', () => {
    expect(assessPassword('password123').score).toBeLessThanOrEqual(1);
    expect(assessPassword('aaaaaaaaaaaa').score).toBeLessThanOrEqual(1);
    expect(assessPassword(generatePassword(DEFAULT_GENERATOR_OPTIONS)).score).toBe(4);
    expect(assessPassword('').score).toBe(0);
  });
});

describe('CSV parsing', () => {
  it('handles quotes, embedded newlines, CRLF, BOM, and keeps spaces', () => {
    const rows = parseCsv('﻿name,password\r\n"Acme, Inc"," spaced "\r\n"multi\nline","say ""hi"""\n');
    expect(rows).toEqual([
      ['name', 'password'],
      ['Acme, Inc', ' spaced '],
      ['multi\nline', 'say "hi"'],
    ]);
  });

  it('parses Bitwarden exports', () => {
    const csv = [
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp',
      'Finance,,login,Bank,,,0,https://bank.example,treasurer,pw1,JBSWY3DPEHPK3PXP',
      ',,note,Alarm code,1234,,0,,,,',
    ].join('\n');
    const [bank, note] = parseBitwardenCsv(csv);
    expect(bank).toMatchObject({ name: 'Bank', url: 'https://bank.example/', usernameHint: 'treasurer', tags: ['Finance'], secretType: 'password' });
    expect(bank.payload).toMatchObject({ username: 'treasurer', password: 'pw1', totp: 'JBSWY3DPEHPK3PXP' });
    expect(note).toMatchObject({ name: 'Alarm code', secretType: 'note', payload: { notes: '1234' } });
  });

  it('parses LastPass exports, including secure notes', () => {
    const csv = ['url,username,password,totp,extra,name,grouping,fav', 'example.com,me,pw,,,Example,Work,0', 'http://sn,,,,Door code 42,Office,,0'].join('\n');
    const [login, note] = parseLastPassCsv(csv);
    expect(login).toMatchObject({ url: 'https://example.com/', tags: ['Work'], payload: { password: 'pw' } });
    expect(note).toMatchObject({ secretType: 'note', url: undefined, payload: { notes: 'Door code 42' } });
  });

  it('parses generic CSVs and drops unsafe URLs', () => {
    const [item] = parseGenericCsv('Title,Website,Email,Pass\nRouter,javascript:alert(1),admin@x.org,pw');
    expect(item).toMatchObject({ name: 'Router', url: undefined, usernameHint: 'admin@x.org', payload: { password: 'pw' } });
    expect(() => parseGenericCsv('foo,bar\n1,2')).toThrow();
  });

  it('exports CSV that re-imports to the same data', () => {
    const items = parseBitwardenCsv('name,login_uri,login_username,login_password,notes,folder\n"Comma, Co",https://c.example/,u,"p,w",note,F');
    const again = parseBitwardenCsv(toBitwardenCsv(items));
    expect(again[0]).toMatchObject({ name: 'Comma, Co', payload: { password: 'p,w', username: 'u', notes: 'note' }, tags: ['F'] });
  });
});

describe('encrypted backups', () => {
  it('round-trips with the passphrase and rejects a wrong one', async () => {
    const items = parseGenericCsv('name,password\nA,1\nB,2');
    const file = await createEncryptedBackup(items, 'a long backup passphrase');
    expect(isEncryptedBackup(file)).toBe(true);
    expect(file).not.toContain('"1"');
    expect(await readEncryptedBackup(file, 'a long backup passphrase')).toEqual(JSON.parse(JSON.stringify(items)));
    await expect(readEncryptedBackup(file, 'wrong passphrase')).rejects.toThrow(/passphrase/);
    expect(isEncryptedBackup('name,password')).toBe(false);
  }, 30_000);
});
