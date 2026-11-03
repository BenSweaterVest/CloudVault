/**
 * A D1Database implementation backed by Node's built-in SQLite (node:sqlite).
 *
 * It runs the real migrations and real SQL, so route tests exercise the same
 * queries production does. Behavior mirrors D1 where it matters:
 *   - binding `undefined` throws (D1 rejects it)
 *   - booleans are stored as 0/1
 *   - batch() runs in a single transaction and rolls back on error
 */

import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Loaded at runtime: Vite strips the "node:" prefix from static imports of
// newer built-ins such as node:sqlite, which then fail to resolve.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

type Value = string | number | bigint | null | Uint8Array;

function normalize(params: unknown[]): Value[] {
  return params.map((p, i) => {
    if (p === undefined) throw new Error(`D1_TYPE_ERROR: undefined bound at position ${i + 1}`);
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p as Value;
  });
}

class TestStatement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: Value[] = []
  ) {}

  bind(...params: unknown[]): TestStatement {
    return new TestStatement(this.db, this.sql, normalize(params));
  }

  execute(): { results: Record<string, unknown>[]; changes: number } {
    const results = this.db.prepare(this.sql).all(...this.params) as Record<string, unknown>[];
    const { c } = this.db.prepare('SELECT changes() AS c').get() as { c: number };
    return { results: results.map((r) => ({ ...r })), changes: c };
  }

  async first<T>(column?: string): Promise<T | null> {
    const { results } = this.execute();
    const row = results[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T>() {
    const { results, changes } = this.execute();
    return { results: results as T[], success: true, meta: { changes } };
  }

  async run() {
    const { results, changes } = this.execute();
    return { results, success: true, meta: { changes } };
  }

  async raw<T>() {
    const { results } = this.execute();
    return results.map((r) => Object.values(r)) as T[];
  }
}

export class TestD1 {
  readonly sqlite: DatabaseSync;

  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    const dir = join(__dirname, '..', '..', '..', 'migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      this.sqlite.exec(readFileSync(join(dir, file), 'utf8'));
    }
  }

  prepare(sql: string): TestStatement {
    return new TestStatement(this.sqlite, sql);
  }

  async batch(statements: TestStatement[]) {
    this.sqlite.exec('BEGIN');
    try {
      const out = statements.map((s) => {
        const { results, changes } = s.execute();
        return { results, success: true, meta: { changes } };
      });
      this.sqlite.exec('COMMIT');
      return out;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }

  async exec(sql: string) {
    this.sqlite.exec(sql);
    return { count: 0, duration: 0 };
  }

  /** Synchronous query helper for assertions. */
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return (this.sqlite.prepare(sql).all(...normalize(params)) as Record<string, unknown>[]).map((r) => ({ ...r })) as T[];
  }
}
