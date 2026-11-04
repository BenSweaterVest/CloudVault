/**
 * GitHub OAuth callback: verify the state we stored, then exchange the code.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { authApi } from '../../lib/api';
import { Alert, AuthShell, FullPageSpinner, errorMessage } from '../ui/kit';
import { OAUTH_STATE_KEY } from './LoginForm';

export default function GithubCallback() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Codes are single use; guard against React strict-mode double effects.
    if (started.current) return;
    started.current = true;

    const code = params.get('code');
    const state = params.get('state');
    const expected = sessionStorage.getItem(OAUTH_STATE_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);

    if (params.get('error')) {
      setError(params.get('error_description') || 'GitHub sign-in was cancelled.');
      return;
    }
    if (!code || !state || !expected || state !== expected) {
      setError('This sign-in attempt could not be verified. Please start again from the login page.');
      return;
    }

    authApi
      .githubCallback(code)
      .then((response) => {
        login(response);
        navigate(response.needsKeySetup ? '/setup' : '/', { replace: true });
      })
      .catch((err) => setError(errorMessage(err, 'GitHub sign-in failed')));
  }, [params, login, navigate]);

  if (!error) return <FullPageSpinner />;

  return (
    <AuthShell title="Sign-in failed">
      <div className="space-y-4">
        <Alert tone="error">{error}</Alert>
        <Link to="/login" className="block text-center text-sm font-medium text-vault-600 hover:text-vault-700">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}
