# Testing

Both packages use [Vitest](https://vitest.dev). CI runs lint, typecheck and tests for both on every push and pull request.

```bash
cd worker   && npm run test:run     # API
cd frontend && npm run test:run     # browser code
npm test                            # watch mode, in either package
npm run test:coverage               # coverage report
```

## Worker

The worker tests exercise the real Hono app and the real SQL. `src/__tests__/helpers/d1.ts` implements the `D1Database` interface on top of Node's built-in `node:sqlite` and applies every file in `migrations/` to a fresh in-memory database per test. It mirrors D1 where it matters: binding `undefined` throws, booleans become 0/1, and `batch()` is one transaction.

Helpers in `src/__tests__/helpers/app.ts`:

| Helper | Purpose |
|--------|---------|
| `createTestContext(envOverrides?)` | Fresh database and env; `ctx.json(method, path, { token, body })` |
| `createUserWithToken(ctx, email)` | User with (fake) keys and a live session |
| `createOrgFixture(ctx)` | Org with an admin, a member, a read-only user and an outsider |
| `secretBody(overrides)` | Valid create-secret body |

| File | Covers |
|------|--------|
| `auth.test.ts` | Magic links (hashing, single use, expiry, invite-only, per-address limit), GitHub account linking and takeover protection, sessions (revocation, idle timeout, sign out everywhere), key setup and master password change |
| `orgs.test.ts` | Roles and access, invites and approvals, last-admin protection, removal clean-up, atomic deletion, key rotation (including conflict detection) |
| `secrets.test.ts` | Metadata-only listing and audited views, format 2 ids, URL and IV validation, cross-org categories, history and version conflicts, route ordering, bulk import, per-user favorites, deletion |
| `sharing-emergency.test.ts` | Share links (view limits, password verifier, revocation, org settings) and the full emergency access lifecycle |
| `platform.test.ts` | Audit filters and CSV formula escaping, settings, health, maintenance job, CORS, configuration checks, rate limiting, headers |
| `validation.test.ts` | Zod schemas |

## Frontend

Library tests run in the Node environment (Web Crypto there shares a realm with the test's typed arrays; under jsdom it does not). Component and hook tests run in jsdom with the stubs in `src/__tests__/setup.ts`.

| File | Covers |
|------|--------|
| `crypto.test.ts` | Key setup and unlock, re-wrapping, fingerprints, admin-to-member key sharing, AAD binding, legacy format 1, share packages and password verifiers |
| `totp.test.ts` | RFC 6238 test vectors (SHA-1 and SHA-256), otpauth parsing |
| `passwords-importers.test.ts` | Generator (character sets, uniformity), strength scoring, CSV parsing for Bitwarden, LastPass and generic files, CSV round trip, encrypted backups |
| `api.test.ts` | Token handling, error parsing, session-ended events, network errors |
| `hooks.test.ts` | Clipboard clearing, idle timeout |
| `components.test.tsx` | Toasts, theme, password generator, login (OAuth state, configured methods), share page |

## Manual end-to-end check

For changes that touch several layers, run the real stack:

```bash
cd worker && npm run db:migrate && npm run dev
cd frontend && npm run dev
```

Then walk through: sign up with a magic link (printed by the worker), create a master password, create an organization, add an item with a 2FA secret, edit it and check history, share it and open the link in a private window, invite a second account and approve it after comparing fingerprints, remove it and rotate the key, and check the audit log.
