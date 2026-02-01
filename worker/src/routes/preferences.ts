/**
 * User Preferences Routes
 * 
 * Manage user settings like theme, session timeout, etc.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../index';
import { authMiddleware } from '../middleware/auth';
import { validateBody, updatePreferencesSchema } from '../lib/validation';

export const preferencesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// All routes require authentication
preferencesRoutes.use('*', authMiddleware);

/**
 * Get user preferences
 */
preferencesRoutes.get('/', async (c) => {
  const user = c.get('user')!;
  
  // Get or create preferences
  let prefs = await c.env.DB.prepare(
    'SELECT * FROM user_preferences WHERE user_id = ?'
  )
    .bind(user.id)
    .first<{
      user_id: string;
      theme: string;
      session_timeout: number;
      clipboard_clear: number;
      show_favicons: number;
      compact_view: number;
    }>();
  
  if (!prefs) {
    // Create default preferences
    await c.env.DB.prepare(`
      INSERT INTO user_preferences (user_id) VALUES (?)
    `)
      .bind(user.id)
      .run();
    
    prefs = {
      user_id: user.id,
      theme: 'system',
      session_timeout: 15,
      clipboard_clear: 30,
      show_favicons: 1,
      compact_view: 0,
    };
  }
  
  return c.json({
    theme: prefs.theme,
    sessionTimeout: prefs.session_timeout,
    clipboardClear: prefs.clipboard_clear,
    showFavicons: prefs.show_favicons === 1,
    compactView: prefs.compact_view === 1,
  });
});

/**
 * Update user preferences
 */
preferencesRoutes.put('/', async (c) => {
  const user = c.get('user')!;
  const data = await validateBody(c, updatePreferencesSchema);
  
  // Ensure preferences row exists
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)
  `)
    .bind(user.id)
    .run();
  
  // Build update query
  const updates: string[] = [];
  const values: (string | number)[] = [];
  
  if (data.theme !== undefined) {
    updates.push('theme = ?');
    values.push(data.theme);
  }
  if (data.sessionTimeout !== undefined) {
    updates.push('session_timeout = ?');
    values.push(data.sessionTimeout);
  }
  if (data.clipboardClear !== undefined) {
    updates.push('clipboard_clear = ?');
    values.push(data.clipboardClear);
  }
  if (data.showFavicons !== undefined) {
    updates.push('show_favicons = ?');
    values.push(data.showFavicons ? 1 : 0);
  }
  if (data.compactView !== undefined) {
    updates.push('compact_view = ?');
    values.push(data.compactView ? 1 : 0);
  }
  
  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(user.id);
    
    await c.env.DB.prepare(
      `UPDATE user_preferences SET ${updates.join(', ')} WHERE user_id = ?`
    )
      .bind(...values)
      .run();
  }
  
  // Return updated preferences
  const prefs = await c.env.DB.prepare(
    'SELECT * FROM user_preferences WHERE user_id = ?'
  )
    .bind(user.id)
    .first<{
      theme: string;
      session_timeout: number;
      clipboard_clear: number;
      show_favicons: number;
      compact_view: number;
    }>();
  
  return c.json({
    theme: prefs!.theme,
    sessionTimeout: prefs!.session_timeout,
    clipboardClear: prefs!.clipboard_clear,
    showFavicons: prefs!.show_favicons === 1,
    compactView: prefs!.compact_view === 1,
  });
});
