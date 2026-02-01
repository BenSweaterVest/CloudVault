# Contributing to CloudVault

Thank you for your interest in contributing to CloudVault! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- Git
- Cloudflare account (for testing)

### Development Setup

1. **Fork the repository** on GitHub

2. **Clone your fork**:
   ```bash
   git clone https://github.com/your-username/cloudvault.git
   cd cloudvault
   ```

3. **Install dependencies**:
   ```bash
   cd frontend && npm install && cd ..
   cd worker && npm install && cd ..
   ```

4. **Set up local environment**:
   ```bash
   # Create local secrets file
   cp worker/.dev.vars.example worker/.dev.vars
   # Edit .dev.vars with your test credentials
   ```

5. **Create local database**:
   ```bash
   cd worker
   wrangler d1 create cloudvault-db --local
   npm run db:migrate
   ```

6. **Start development servers**:
   ```bash
   # Terminal 1: Worker
   cd worker && npm run dev

   # Terminal 2: Frontend
   cd frontend && npm run dev
   ```

7. Visit `http://localhost:5173`

## Development Workflow

### Branch Naming

Use descriptive branch names:
- `feature/add-password-generator`
- `fix/clipboard-clear-bug`
- `docs/update-api-reference`
- `refactor/improve-crypto-module`

### Making Changes

1. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the code style guidelines

3. **Run tests**:
   ```bash
   cd frontend && npm run test
   ```

4. **Run linting**:
   ```bash
   cd frontend && npm run lint
   cd ../worker && npm run typecheck
   ```

5. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add password strength indicator"
   ```

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, no logic change)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(auth): add magic link expiration warning
fix(crypto): handle empty password edge case
docs(api): add rate limit documentation
refactor(vault): extract secret list filtering logic
```

### Pull Request Process

1. **Update documentation** if needed
2. **Add tests** for new functionality
3. **Ensure all checks pass**
4. **Create a pull request** with:
   - Clear title following commit format
   - Description of changes
   - Screenshots for UI changes
   - Link to related issue (if any)

5. **Address review feedback**
6. **Squash commits** if requested

## Code Style Guidelines

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Prefer `interface` over `type` for object shapes
- Use explicit return types for functions

```typescript
// Good
interface User {
  id: string;
  email: string;
}

function getUser(id: string): Promise<User> {
  // ...
}

// Avoid
type User = {
  id: string;
  email: string;
}

function getUser(id) {
  // ...
}
```

### React

- Use functional components with hooks
- Use named exports for components
- Keep components focused and small
- Extract reusable logic into custom hooks

```typescript
// Good
export function SecretCard({ secret, onEdit }: SecretCardProps) {
  const { copy, copied } = useClipboard();
  // ...
}

// Avoid
export default class SecretCard extends React.Component {
  // ...
}
```

### CSS/Tailwind

- Use Tailwind utility classes
- Extract common patterns to components
- Support dark mode for all UI
- Ensure accessible color contrast

```tsx
// Good
<button className="px-4 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700 dark:bg-vault-500">
  Save
</button>
```

### API Routes

- Use Zod for input validation
- Return consistent error responses
- Log audit events for sensitive actions
- Include appropriate HTTP status codes

```typescript
// Good
secretsRoutes.post('/:orgId/secrets', async (c) => {
  const data = await validateBody(c, createSecretSchema);
  // ...
  audit.log('CREATE_SECRET', { /* ... */ });
  return c.json(result, 201);
});
```

## Testing

Comprehensive testing ensures CloudVault's security and reliability. See [TESTING.md](docs/TESTING.md) for detailed documentation.

### Running Tests

```bash
# Frontend tests
cd frontend
npm test              # Watch mode (development)
npm run test -- --run # Single run (CI)
npm run test:coverage # With coverage report

# Worker tests
cd worker
npm test              # Watch mode
npm run test:run      # Single run
npm run test:coverage # With coverage
```

### Test Categories

| Category | Location | Purpose |
|----------|----------|---------|
| **Unit** | `*.test.ts` | Individual functions/components |
| **Component** | `components.test.tsx` | React component behavior |
| **Integration** | `integration.test.ts` | Full user flows |
| **Validation** | `validation.test.ts` | API input validation |

### Writing Tests

Follow these principles:

1. **Test behavior, not implementation**
2. **Use descriptive test names**
3. **Follow Arrange-Act-Assert pattern**
4. **Cover edge cases** (empty, unicode, max length)
5. **Keep tests independent**

```typescript
describe('useClipboard', () => {
  it('should copy text to clipboard', async () => {
    // Arrange
    const { result } = renderHook(() => useClipboard());
    
    // Act
    await act(async () => {
      await result.current.copy('test');
    });
    
    // Assert
    expect(result.current.copied).toBe(true);
  });

  it('should auto-clear after timeout', async () => {
    const { result } = renderHook(() => useClipboard({ clearAfterSeconds: 5 }));
    await act(async () => {
      await result.current.copy('sensitive');
    });
    
    // Fast-forward time
    vi.advanceTimersByTime(5000);
    
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('');
  });
});
```

### Coverage Requirements

New code should maintain or improve test coverage:
- **Minimum**: 60% coverage for new files
- **Target**: 70%+ for critical paths (crypto, auth)

## Security Considerations

When contributing security-related code:

1. **Never log sensitive data** (passwords, keys, tokens)
2. **Use constant-time comparison** for secrets
3. **Validate all inputs** on the server
4. **Sanitize outputs** to prevent XSS
5. **Follow the zero-knowledge principle** - server should never see plaintext

For security vulnerabilities, please report privately rather than opening a public issue.

## Documentation

- Update README.md for user-facing changes
- Update docs/API.md for API changes
- Add JSDoc comments for public functions
- Include code examples where helpful

## Questions?

- Open a GitHub Discussion in the repository for questions
- Check existing issues before creating new ones
- Join our community chat (if available)

## License

By contributing, you agree that your contributions will be licensed under the project's MIT License.

---

Thank you for contributing to CloudVault! Your help makes this project better for everyone.
