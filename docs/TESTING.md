# CloudVault Testing Guide

Comprehensive testing documentation for CloudVault's frontend and backend components.

## Quick Start

```bash
# Run all frontend tests
cd frontend && npm test

# Run all worker tests
cd worker && npm test

# Run with coverage
npm run test:coverage
```

## Test Architecture

### Frontend Tests (`frontend/src/__tests__/`)

| File | Purpose | Key Scenarios |
|------|---------|---------------|
| `setup.ts` | Test environment configuration | Mocks for crypto, clipboard, localStorage |
| `crypto.test.ts` | Zero-knowledge encryption | Key derivation, RSA, AES-GCM, E2E flow |
| `hooks.test.ts` | Custom React hooks | useClipboard, useSessionTimeout |
| `components.test.tsx` | UI components | Toast, Theme, Skeleton, Accessibility |
| `api.test.ts` | API client | All endpoints, error handling, auth |
| `totp.test.ts` | 2FA code generation | URI parsing, code generation |
| `integration.test.ts` | Full user flows | Registration, encryption, multi-user |

### Worker Tests (`worker/src/__tests__/`)

| File | Purpose | Key Scenarios |
|------|---------|---------------|
| `validation.test.ts` | Zod schemas | All input validation, edge cases |

## Running Tests

### Frontend

```bash
cd frontend

# Interactive watch mode (recommended for development)
npm test

# Single run (for CI)
npm run test -- --run

# With coverage report
npm run test:coverage

# Run specific test file
npm test -- crypto.test.ts

# Run tests matching pattern
npm test -- --grep "encryption"

# Update snapshots
npm test -- --update
```

### Worker

```bash
cd worker

# Run all tests
npm test

# Single run
npm run test:run

# With coverage
npm run test:coverage
```

## Test Categories

### 1. Unit Tests

Test individual functions and components in isolation.

```typescript
// Example: Testing key derivation
describe('Key Derivation', () => {
  it('should derive consistent key from password', async () => {
    const key1 = await deriveKeyFromPassword('password', 'salt');
    const key2 = await deriveKeyFromPassword('password', 'salt');
    expect(key1).toEqual(key2);
  });
});
```

### 2. Component Tests

Test React components using Testing Library.

```typescript
// Example: Testing toast notifications
describe('Toast Component', () => {
  it('should show success message', async () => {
    render(<ToastProvider><TestComponent /></ToastProvider>);
    fireEvent.click(screen.getByText('Show Success'));
    await waitFor(() => {
      expect(screen.getByText('Success!')).toBeInTheDocument();
    });
  });
});
```

### 3. Integration Tests

Test complete user flows and feature interactions.

```typescript
// Example: Full encryption flow
describe('Full Encryption Flow', () => {
  it('should encrypt and decrypt through entire pipeline', async () => {
    // 1. Generate user keys
    const { publicKey, privateKey } = await generateKeyPair();
    
    // 2. Create org key
    const orgKey = await generateOrgKey();
    
    // 3. Encrypt secret
    const { ciphertext, iv } = await encryptWithOrgKey(orgKey, data);
    
    // 4. Decrypt and verify
    const decrypted = await decryptWithOrgKey(orgKey, ciphertext, iv);
    expect(decrypted).toEqual(data);
  });
});
```

### 4. Validation Tests

Test input validation schemas.

```typescript
// Example: Testing secret creation validation
describe('createSecretSchema', () => {
  it('should reject empty name', () => {
    expect(() => createSecretSchema.parse({
      name: '',
      ciphertextBlob: 'data',
      iv: 'iv',
    })).toThrow(/Name is required/);
  });
});
```

## Mocking

### Mocking Fetch

```typescript
const mockFetch = vi.fn();
global.fetch = mockFetch;

mockFetch.mockResolvedValueOnce({
  ok: true,
  json: () => Promise.resolve({ id: '123' }),
});
```

### Mocking Clipboard

```typescript
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
});
```

### Mocking localStorage

```typescript
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
```

### Mocking Crypto

```typescript
// In setup.ts - uses Node's crypto for test environment
if (typeof globalThis.crypto === 'undefined') {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto as Crypto;
}
```

## Coverage

### Generating Coverage Reports

```bash
# Frontend
cd frontend && npm run test:coverage

# Reports generated in:
# - frontend/coverage/text (terminal)
# - frontend/coverage/html (browser - open index.html)
# - frontend/coverage/json (for CI tools)
```

### Coverage Targets

| Category | Target |
|----------|--------|
| Statements | 70% |
| Branches | 65% |
| Functions | 70% |
| Lines | 70% |

Run `npm run test:coverage` to see current coverage metrics.

### Excluding Files

Coverage excludes:
- Test files (`**/*.test.ts`)
- Type definitions (`**/*.d.ts`)
- Setup files (`__tests__/setup.ts`)

## Writing Good Tests

### Best Practices

1. **Test behavior, not implementation**
   ```typescript
   // Good: Tests what the function does
   it('should encrypt data securely', async () => {
     const result = await encrypt(data);
     expect(result.ciphertext).not.toBe(data);
   });

   // Avoid: Tests how it does it
   it('should call AES-GCM with 256 bits', async () => {
     // Too coupled to implementation
   });
   ```

2. **Use descriptive test names**
   ```typescript
   // Good
   it('should reject passwords shorter than 8 characters')
   
   // Avoid
   it('password validation')
   ```

3. **Arrange-Act-Assert pattern**
   ```typescript
   it('should update secret', async () => {
     // Arrange
     const secret = createTestSecret();
     
     // Act
     const updated = await updateSecret(secret.id, { name: 'New Name' });
     
     // Assert
     expect(updated.name).toBe('New Name');
   });
   ```

4. **Test edge cases**
   ```typescript
   describe('Edge Cases', () => {
     it('should handle empty input');
     it('should handle unicode characters');
     it('should handle maximum length input');
     it('should handle null values');
   });
   ```

5. **Keep tests independent**
   ```typescript
   // Good: Each test sets up its own data
   beforeEach(() => {
     testData = createFreshTestData();
   });
   ```

### Testing Async Code

```typescript
// Using async/await
it('should fetch data', async () => {
  const result = await fetchData();
  expect(result).toBeDefined();
});

// Using waitFor for DOM updates
it('should show loading state', async () => {
  render(<Component />);
  await waitFor(() => {
    expect(screen.getByText('Loaded')).toBeInTheDocument();
  });
});
```

### Testing Error Handling

```typescript
it('should throw on invalid input', async () => {
  await expect(
    processInvalidData()
  ).rejects.toThrow('Invalid input');
});

it('should handle network errors', async () => {
  mockFetch.mockRejectedValueOnce(new Error('Network error'));
  
  const result = await fetchWithErrorHandling();
  expect(result.error).toBe('Network error');
});
```

## CI/CD Integration

Tests run automatically in GitHub Actions:

```yaml
# .github/workflows/ci.yml
frontend-test:
  name: Frontend Tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '18'
    - run: cd frontend && npm ci
    - run: cd frontend && npm run test -- --run
    - run: cd frontend && npm run test:coverage
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        directory: ./frontend/coverage
```

## Debugging Tests

### Running Single Test

```bash
# Run one file
npm test -- crypto.test.ts

# Run one describe block
npm test -- --grep "Key Derivation"

# Run one test
npm test -- --grep "should derive consistent key"
```

### Verbose Output

```bash
npm test -- --reporter=verbose
```

### Debug Mode

Add `debugger` statement and run:
```bash
npm test -- --inspect-brk
```

Then open Chrome DevTools.

## Test Data

### Fixtures

Create reusable test data in `__tests__/fixtures/`:

```typescript
// fixtures/secrets.ts
export const mockPassword = {
  id: 'secret-1',
  name: 'Test Password',
  ciphertextBlob: 'encrypted...',
  iv: 'iv123...',
  secretType: 'password',
};

export const mockApiKey = {
  // ...
};
```

### Factories

Create dynamic test data:

```typescript
// factories/user.ts
export function createTestUser(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    email: `test-${Date.now()}@example.com`,
    name: 'Test User',
    ...overrides,
  };
}
```

## Troubleshooting

### Common Issues

1. **Crypto not available**
   - Ensure `setup.ts` imports Node crypto polyfill

2. **DOM not found**
   - Check `environment: 'jsdom'` in vitest config

3. **Async test timeout**
   - Increase timeout: `vi.setConfig({ testTimeout: 10000 })`

4. **Mock not resetting**
   - Add `vi.clearAllMocks()` in `afterEach`

### Getting Help

- Check Vitest docs: https://vitest.dev
- Testing Library: https://testing-library.com
- Open an issue with failing test output
