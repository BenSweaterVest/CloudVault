/**
 * Sign-in: GitHub OAuth or an emailed magic link.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { authApi, type AuthConfig } from '../../lib/api';
import { randomToken } from '../../lib/crypto';
import { Alert, AuthShell, Button, Field, TextInput, errorMessage } from '../ui/kit';

export const OAUTH_STATE_KEY = 'cloudvault_oauth_state';

export default function LoginForm() {
  const { user, sessionEndedReason } = useAuth();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Assume both methods until the server says otherwise.
  const [config, setConfig] = useState<AuthConfig>({
    github: true,
    magicLink: true,
    signupsAllowed: true,
  });

  useEffect(() => {
    authApi
      .config()
      .then((c) => {
        if (typeof c.github === 'boolean' && typeof c.magicLink === 'boolean') setConfig(c);
      })
      .catch(() => undefined);
  }, []);

  if (user) return <Navigate to="/" replace />;

  const handleGitHub = () => {
    // CSRF protection: the callback only proceeds if GitHub returns this value.
    const state = randomToken(24);
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
    window.location.href = authApi.githubAuthUrl(state);
  };

  const handleMagicLink = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await authApi.requestMagicLink(email.trim());
      setSentTo(email.trim());
    } catch (err) {
      setError(errorMessage(err, 'Could not send the login link'));
    } finally {
      setIsLoading(false);
    }
  };

  if (sentTo) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={
          <>
            If <strong>{sentTo}</strong> can sign in, a login link is on its way.
          </>
        }
      >
        <div className="space-y-4 text-center text-sm text-gray-600 dark:text-gray-400">
          <p>The link works once and expires after a few minutes. Open it in this browser.</p>
          <Button variant="ghost" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Welcome to CloudVault"
      subtitle="Shared passwords for your organization, encrypted in your browser"
    >
      <div className="space-y-5">
        {sessionEndedReason && <Alert tone="info">{sessionEndedReason}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {!config.github && !config.magicLink && (
          <Alert tone="warning">
            No sign-in method is configured on this server. See the deployment guide.
          </Alert>
        )}

        {config.github && (
          <Button variant="secondary" className="w-full py-3" onClick={handleGitHub}>
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
            Continue with GitHub
          </Button>
        )}

        {config.github && config.magicLink && (
          <div className="relative">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-gray-200 dark:border-gray-700" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-2 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                or use a login link
              </span>
            </div>
          </div>
        )}

        {config.magicLink && (
          <form onSubmit={handleMagicLink} className="space-y-4">
            <Field label="Email address">
              {(id) => (
                <TextInput
                  id={id}
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.org"
                />
              )}
            </Field>
            <Button type="submit" className="w-full py-3" loading={isLoading}>
              Email me a login link
            </Button>
          </form>
        )}

        {!config.signupsAllowed && (
          <p className="text-center text-xs text-gray-500 dark:text-gray-400">
            This vault is invite-only. Ask an administrator to invite you.
          </p>
        )}
      </div>
    </AuthShell>
  );
}
