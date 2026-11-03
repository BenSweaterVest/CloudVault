/**
 * Transactional email via Resend (free tier: 100 emails/day).
 *
 * Email is optional. When RESEND_API_KEY is not set, sendEmail() is a no-op
 * that returns false, and callers fall back to in-app flows.
 */

import type { Env } from '../env';

const DEFAULT_FROM = 'CloudVault <noreply@cloudvault.app>';

/** Escape text for safe interpolation into HTML email bodies. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  /** Pre-escaped HTML body */
  html: string;
}

/**
 * Send an email. Never throws: failures are logged and reported as `false`
 * so that callers do not leak delivery status to unauthenticated clients.
 */
export async function sendEmail(env: Env, message: EmailMessage): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || DEFAULT_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
      }),
    });
    if (!response.ok) {
      console.error('Email send failed with status', response.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Email service error:', err instanceof Error ? err.message : 'unknown');
    return false;
  }
}

/** Wrap content in a minimal, consistent email layout. */
export function emailLayout(title: string, bodyHtml: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
      <h2 style="margin-bottom: 16px;">${escapeHtml(title)}</h2>
      ${bodyHtml}
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
        Sent by CloudVault. If you did not expect this email, you can ignore it.
      </p>
    </div>
  `;
}

/** A call-to-action button for emails. `url` must already be trusted. */
export function emailButton(label: string, url: string): string {
  const safeUrl = escapeHtml(url);
  return `
    <p>
      <a href="${safeUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0284c7; color: #ffffff; text-decoration: none; border-radius: 6px;">${escapeHtml(label)}</a>
    </p>
    <p style="font-size: 13px; color: #4b5563;">Or copy this link: ${safeUrl}</p>
  `;
}
