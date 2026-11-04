import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { ToastProvider, useToast } from '../components/ui/Toast';
import { ThemeProvider, ThemeToggle } from '../components/ui/ThemeProvider';
import PasswordGenerator from '../components/vault/PasswordGenerator';
import LoginForm, { OAUTH_STATE_KEY } from '../components/auth/LoginForm';
import SharedSecretPage from '../components/share/SharedSecretPage';
import { AuthProvider } from '../lib/auth';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string, routePath: string, element: ReactElement) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

function ToastButton() {
  const { success } = useToast();
  return <button onClick={() => success('Saved', 'All good')}>notify</button>;
}

describe('Toast', () => {
  it('shows messages', async () => {
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>
    );
    await userEvent.click(screen.getByText('notify'));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});

describe('ThemeProvider', () => {
  it('toggles dark mode on the document', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );
    const toggle = screen.getByRole('button');
    const seen = new Set<boolean>();
    for (let i = 0; i < 3; i++) {
      await userEvent.click(toggle);
      seen.add(document.documentElement.classList.contains('dark'));
    }
    expect(seen.has(true)).toBe(true);
  });
});

describe('PasswordGenerator', () => {
  it('generates a password of at least the minimum length and returns it', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <PasswordGenerator minLength={24} onSelect={onSelect} onClose={onClose} />
      </ToastProvider>
    );
    const value = screen.getByTestId('generated-password').textContent ?? '';
    expect(value.length).toBeGreaterThanOrEqual(24);

    await userEvent.click(screen.getByText('Use password'));
    expect(onSelect).toHaveBeenCalledWith(value);
    expect(onClose).toHaveBeenCalled();
  });

  it('warns when no character types are selected', async () => {
    render(<PasswordGenerator onSelect={vi.fn()} onClose={vi.fn()} />);
    for (const label of ['Uppercase (A-Z)', 'Lowercase (a-z)', 'Numbers (0-9)', 'Symbols (!@#...)']) {
      await userEvent.click(screen.getByLabelText(label));
    }
    expect(screen.getByText('Select at least one character type.')).toBeInTheDocument();
    expect(screen.getByText('Use password')).toBeDisabled();
  });
});

describe('LoginForm', () => {
  it('stores an OAuth state before redirecting to GitHub', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, set href(v: string) { assign(v); } } });

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginForm />
        </AuthProvider>
      </MemoryRouter>
    );
    await userEvent.click(await screen.findByText('Continue with GitHub'));

    const state = sessionStorage.getItem(OAUTH_STATE_KEY);
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(assign).toHaveBeenCalledWith(`/api/auth/github?state=${state}`);
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('requests a magic link and confirms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).endsWith('/auth/config')
          ? new Response(JSON.stringify({ github: false, magicLink: true, signupsAllowed: true }))
          : new Response(JSON.stringify({ message: 'ok' }))
      )
    );
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginForm />
        </AuthProvider>
      </MemoryRouter>
    );
    await userEvent.type(await screen.findByLabelText('Email address'), 'me@example.org');
    await userEvent.click(screen.getByText('Email me a login link'));
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
  });

  it('hides GitHub sign-in when the server has not configured it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ github: false, magicLink: true, signupsAllowed: false }))));
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginForm />
        </AuthProvider>
      </MemoryRouter>
    );
    expect(await screen.findByText(/invite-only/)).toBeInTheDocument();
    expect(screen.queryByText('Continue with GitHub')).not.toBeInTheDocument();
  });
});

describe('SharedSecretPage', () => {
  it('explains when the link key is missing', async () => {
    renderAt('/share/abc', '/share/:linkId', <SharedSecretPage />);
    expect(await screen.findByText(/link is incomplete/)).toBeInTheDocument();
  });
});
