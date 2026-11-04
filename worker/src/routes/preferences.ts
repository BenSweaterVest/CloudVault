/**
 * User preferences (theme, idle timeout, clipboard clearing, display).
 *
 * Mounted at /api/preferences (authenticated).
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { getUser } from '../lib/http';
import { updatePreferencesSchema, validateBody } from '../lib/validation';

export const preferencesRoutes = new Hono<AppEnv>();

interface PrefsRow {
  theme: string;
  session_timeout: number;
  clipboard_clear: number;
  show_favicons: number;
  compact_view: number;
}

const DEFAULTS: PrefsRow = {
  theme: 'system',
  session_timeout: 15,
  clipboard_clear: 30,
  show_favicons: 1,
  compact_view: 0,
};

function serialize(p: PrefsRow) {
  return {
    theme: p.theme,
    sessionTimeout: p.session_timeout,
    clipboardClear: p.clipboard_clear,
    showFavicons: p.show_favicons === 1,
    compactView: p.compact_view === 1,
  };
}

preferencesRoutes.get('/', async (c) => {
  const user = getUser(c);
  const prefs = await c.env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?').bind(user.id).first<PrefsRow>();
  return c.json(serialize(prefs ?? DEFAULTS));
});

preferencesRoutes.put('/', async (c) => {
  const user = getUser(c);
  const data = await validateBody(c, updatePreferencesSchema);
  const db = c.env.DB;

  const updates: string[] = [];
  const values: (string | number)[] = [];
  if (data.theme !== undefined) (updates.push('theme = ?'), values.push(data.theme));
  if (data.sessionTimeout !== undefined) (updates.push('session_timeout = ?'), values.push(data.sessionTimeout));
  if (data.clipboardClear !== undefined) (updates.push('clipboard_clear = ?'), values.push(data.clipboardClear));
  if (data.showFavicons !== undefined) (updates.push('show_favicons = ?'), values.push(data.showFavicons ? 1 : 0));
  if (data.compactView !== undefined) (updates.push('compact_view = ?'), values.push(data.compactView ? 1 : 0));

  const statements: D1PreparedStatement[] = [
    db.prepare('INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)').bind(user.id),
  ];
  if (updates.length > 0) {
    statements.push(
      db
        .prepare(`UPDATE user_preferences SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`)
        .bind(...values, user.id)
    );
  }
  // The idle timeout is enforced per session, so apply it to live sessions too.
  if (data.sessionTimeout !== undefined) {
    statements.push(
      db.prepare('UPDATE sessions SET timeout_minutes = ? WHERE user_id = ? AND revoked = 0').bind(data.sessionTimeout, user.id)
    );
  }
  await db.batch(statements);

  const prefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').bind(user.id).first<PrefsRow>();
  return c.json(serialize(prefs ?? DEFAULTS));
});
