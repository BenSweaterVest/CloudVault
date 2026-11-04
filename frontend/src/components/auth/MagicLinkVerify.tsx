/**
 * Landing page for emailed login links: /auth/magic-link#token=...
 *
 * The token is in the URL fragment so it never reaches any server log. It is
 * removed from the address bar before use.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { authApi } from '../../lib/api';
import { Alert, AuthShell, FullPageSpinner, errorMessage } from '../ui/kit';

export default function MagicLinkVerify() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const fragment = new URLSearchParams(window.location.hash.slice(1));
    // Older links put the token in the query string.
    const token = fragment.get('token') ?? new URLSearchParams(window.location.search).get('token');
    window.history.replaceState(null, '', window.location.pathname);

    if (!token) {
      setError('This login link is incomplete. Request a new one.');
      return;
    }

    authApi
      .verifyMagicLink(token)
      .then((response) => {
        login(response);
        navigate(response.needsKeySetup ? '/setup' : '/', { replace: true });
      })
      .catch((err) => setError(errorMessage(err, 'This login link is invalid or has expired')));
  }, [login, navigate]);

  if (!error) return <FullPageSpinner />;

  return (
    <AuthShell title="Login link not valid">
      <div className="space-y-4">
        <Alert tone="error">{error}</Alert>
        <Link to="/login" className="block text-center text-sm font-medium text-vault-600 hover:text-vault-700">
          Request a new link
        </Link>
      </div>
    </AuthShell>
  );
}
