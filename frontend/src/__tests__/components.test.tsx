/**
 * Component Tests
 * 
 * Tests for React components using React Testing Library.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// import userEvent from '@testing-library/user-event';  // TODO: Use for more realistic user interactions
import { BrowserRouter } from 'react-router-dom';

// Test utilities
// const renderWithRouter = (component: React.ReactElement) => {
//   return render(
//     <BrowserRouter>
//       {component}
//     </BrowserRouter>
//   );
// };

// Helper to render components with router context
function renderWithRouter(component: React.ReactElement) {
  return render(
    <BrowserRouter>
      {component}
    </BrowserRouter>
  );
}

// ============================================
// TOAST COMPONENT TESTS
// ============================================

import { ToastProvider, useToast } from '../components/ui/Toast';

function TestToastComponent() {
  const { success, error, warning, info } = useToast();
  
  return (
    <div>
      <button onClick={() => success('Success Title', 'Success message')}>
        Show Success
      </button>
      <button onClick={() => error('Error Title', 'Error message')}>
        Show Error
      </button>
      <button onClick={() => warning('Warning Title', 'Warning message')}>
        Show Warning
      </button>
      <button onClick={() => info('Info Title', 'Info message')}>
        Show Info
      </button>
    </div>
  );
}

describe('Toast Component', () => {
  it('should show success toast when triggered', async () => {
    render(
      <ToastProvider>
        <TestToastComponent />
      </ToastProvider>
    );
    
    fireEvent.click(screen.getByText('Show Success'));
    
    await waitFor(() => {
      expect(screen.getByText('Success Title')).toBeInTheDocument();
      expect(screen.getByText('Success message')).toBeInTheDocument();
    });
  });

  it('should show error toast when triggered', async () => {
    render(
      <ToastProvider>
        <TestToastComponent />
      </ToastProvider>
    );
    
    fireEvent.click(screen.getByText('Show Error'));
    
    await waitFor(() => {
      expect(screen.getByText('Error Title')).toBeInTheDocument();
    });
  });

  it('should allow multiple toasts', async () => {
    render(
      <ToastProvider>
        <TestToastComponent />
      </ToastProvider>
    );
    
    fireEvent.click(screen.getByText('Show Success'));
    fireEvent.click(screen.getByText('Show Error'));
    
    await waitFor(() => {
      expect(screen.getByText('Success Title')).toBeInTheDocument();
      expect(screen.getByText('Error Title')).toBeInTheDocument();
    });
  });
});

// ============================================
// THEME PROVIDER TESTS
// ============================================

import { ThemeProvider, useTheme, ThemeToggle } from '../components/ui/ThemeProvider';

function TestThemeComponent() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <button onClick={() => setTheme('dark')}>Set Dark</button>
      <button onClick={() => setTheme('light')}>Set Light</button>
      <button onClick={() => setTheme('system')}>Set System</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark', 'light');
  });

  it('should default to system theme', () => {
    render(
      <ThemeProvider>
        <TestThemeComponent />
      </ThemeProvider>
    );
    
    expect(screen.getByTestId('current-theme')).toHaveTextContent('system');
  });

  it('should change to dark theme when set', async () => {
    render(
      <ThemeProvider>
        <TestThemeComponent />
      </ThemeProvider>
    );
    
    fireEvent.click(screen.getByText('Set Dark'));
    
    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  it('should change to light theme when set', async () => {
    render(
      <ThemeProvider>
        <TestThemeComponent />
      </ThemeProvider>
    );
    
    fireEvent.click(screen.getByText('Set Light'));
    
    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('light');
    });
  });

  it('should persist theme to localStorage', async () => {
    render(
      <ThemeProvider>
        <TestThemeComponent />
      </ThemeProvider>
    );
    
    fireEvent.click(screen.getByText('Set Dark'));
    
    await waitFor(() => {
      expect(localStorage.getItem('cloudvault-theme')).toBe('dark');
    });
  });
});

describe('ThemeToggle', () => {
  it('should render toggle button', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );
    
    expect(screen.getByRole('button', { name: /toggle theme/i })).toBeInTheDocument();
  });
});

// ============================================
// SKELETON COMPONENT TESTS
// ============================================

import { Skeleton, SkeletonText, SkeletonCard } from '../components/ui/Skeleton';

describe('Skeleton Components', () => {
  it('should render base skeleton', () => {
    render(<Skeleton className="test-class" />);
    const skeleton = document.querySelector('.animate-pulse');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveClass('test-class');
  });

  it('should render skeleton text with correct number of lines', () => {
    render(<SkeletonText lines={3} />);
    const lines = document.querySelectorAll('.animate-pulse');
    expect(lines.length).toBe(3);
  });

  it('should render skeleton card', () => {
    render(<SkeletonCard />);
    const card = document.querySelector('.rounded-lg');
    expect(card).toBeInTheDocument();
  });
});

// ============================================
// ACCESSIBILITY COMPONENT TESTS
// ============================================

import { SkipLink, VisuallyHidden, IconButton } from '../components/ui/Accessibility';

describe('Accessibility Components', () => {
  describe('SkipLink', () => {
    it('should render skip link', () => {
      render(<SkipLink targetId="main" />);
      const link = screen.getByText('Skip to main content');
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '#main');
    });

    it('should have sr-only class by default', () => {
      render(<SkipLink targetId="main" />);
      const link = screen.getByText('Skip to main content');
      expect(link).toHaveClass('sr-only');
    });
  });

  describe('VisuallyHidden', () => {
    it('should render content but visually hide it', () => {
      render(<VisuallyHidden>Hidden text</VisuallyHidden>);
      const span = screen.getByText('Hidden text');
      expect(span).toBeInTheDocument();
    });
  });

  describe('IconButton', () => {
    it('should render button with aria-label', () => {
      render(
        <IconButton label="Close" onClick={() => {}}>
          X
        </IconButton>
      );
      const button = screen.getByRole('button', { name: 'Close' });
      expect(button).toBeInTheDocument();
    });

    it('should call onClick when clicked', async () => {
      const handleClick = vi.fn();
      render(
        <IconButton label="Test" onClick={handleClick}>
          X
        </IconButton>
      );
      
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================
// ERROR BOUNDARY TESTS
// ============================================

import ErrorBoundary from '../components/ui/ErrorBoundary';

function ThrowingComponent() {
  throw new Error('Test error');
}

describe('ErrorBoundary', () => {
  // Suppress console.error for error boundary tests
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });

  it('should render children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>
    );
    
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('should render error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  // Restore console.error
  afterAll(() => {
    console.error = originalError;
  });
});

// ============================================
// PASSWORD GENERATOR TESTS
// ============================================

import PasswordGenerator from '../components/vault/PasswordGenerator';

describe('PasswordGenerator', () => {
  it('should render with default options', () => {
    render(<PasswordGenerator onSelect={() => {}} onClose={() => {}} />);
    
    // Check for key UI elements
    expect(screen.getByText('Length')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('should generate password on button click', async () => {
    render(<PasswordGenerator onSelect={() => {}} onClose={() => {}} />);
    
    // The regenerate button has title="Regenerate"
    const regenerateButton = screen.getByTitle('Regenerate');
    
    // Get initial password from code element
    const passwordField = document.querySelector('code');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(passwordField).toBeInTheDocument();
    
    // Click regenerate
    fireEvent.click(regenerateButton);
    
    await waitFor(() => {
      const password = passwordField?.textContent;
      expect(password).toBeDefined();
      expect(password!.length).toBeGreaterThan(0);
    });
  });

  it('should call onSelect when Use Password is clicked', async () => {
    const onSelect = vi.fn();
    render(<PasswordGenerator onSelect={onSelect} onClose={() => {}} />);
    
    // Wait for password to be generated
    await waitFor(() => {
      const passwordField = document.querySelector('code');
      expect(passwordField?.textContent?.length).toBeGreaterThan(0);
    });
    
    const useButton = screen.getByText('Use Password');
    fireEvent.click(useButton);
    
    expect(onSelect).toHaveBeenCalled();
  });

  it('should call onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<PasswordGenerator onSelect={() => {}} onClose={onClose} />);
    
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);
    
    expect(onClose).toHaveBeenCalled();
  });

  it('should update password length when slider changes', async () => {
    render(<PasswordGenerator onSelect={() => {}} onClose={() => {}} />);
    
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '24' } });
    
    // Check that the length label updated
    await waitFor(() => {
      expect(screen.getByText('24')).toBeInTheDocument();
    });
  });

  it('should have character type checkboxes', () => {
    render(<PasswordGenerator onSelect={() => {}} onClose={() => {}} />);
    
    expect(screen.getByLabelText(/uppercase/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/lowercase/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/numbers/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/symbols/i)).toBeInTheDocument();
  });
});
