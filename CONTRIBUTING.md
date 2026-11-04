# Contributing to CloudVault

Thanks for helping. CloudVault guards other people's passwords, so changes are held to a careful standard: small, tested, and explained.

## Setup

Requires Node.js 22+ (the worker tests use Node's built-in SQLite).

```bash
git clone https://github.com/<you>/CloudVault.git
cd CloudVault
(cd worker && npm install && cp .dev.vars.example .dev.vars)
(cd frontend && npm install)
```

Edit `worker/.dev.vars` (at minimum `JWT_SECRET` and `APP_URL=http://localhost:5173`), then:

```bash
cd worker && npm run db:migrate && npm run dev     # terminal 1, API on :8787
cd frontend && npm run dev                          # terminal 2, app on :5173
```

Magic links are printed in terminal 1 when no Resend key is set.

## Before opening a pull request

Run the same checks CI runs, in both `worker/` and `frontend/`:

```bash
npm run lint
npm run typecheck
npm run test:run
```

and `npm run build` in `frontend/`.

## Ground rules

**Security**
- The server must never receive plaintext secrets, master passwords, private keys or org keys. If a feature seems to need that, it needs a different design.
- New cryptography goes in `frontend/src/lib/crypto.ts` (or a sibling module), uses Web Crypto only, and comes with tests. Don't add crypto dependencies.
- Changing how items are encrypted means a new `enc_version`, keeping old versions readable.
- Every route that reads a body uses a Zod schema from `worker/src/lib/validation.ts`, and every org route starts with `requireMembership(c, orgId, minRole)`.
- Security-relevant actions write an audit entry (add new actions to `AUDIT_ACTIONS`).

**Free plan**
- No new Cloudflare bindings beyond D1 without a strong reason. KV was removed on purpose.
- Keep server CPU tiny (no slow KDFs in the Worker).
- Stay well under 50 D1 queries per request; use `DB.batch()` for multi-step changes and `json_each` for bulk rows.

**Database**
- Schema changes are new files in `worker/migrations/` (`000N_description.sql`). Never edit a migration that has shipped.

**Frontend**
- All API calls go through `src/lib/api.ts`.
- Use the primitives in `components/ui/kit.tsx`, and check dark mode and a 390 px wide screen.
- Keys stay in memory. Navigate with the router, not full page loads.

## Tests

- Worker route tests (`worker/src/__tests__`) run the app against real migrations through a D1 shim. Use `createTestContext()` and `createOrgFixture()` from `helpers/app.ts`.
- Frontend library tests run in the Node environment (`// @vitest-environment node`); component tests run in jsdom.
- Bug fixes come with a test that fails without the fix.

See [docs/TESTING.md](docs/TESTING.md).

## Commits and pull requests

- One logical change per pull request, with a description of what changed and why, and how you tested it.
- Note any migration, new setting or behavior change in `CHANGELOG.md` under "Unreleased".

## Reporting security issues

Please don't open a public issue. Use GitHub's private vulnerability reporting (Security tab). See [docs/SECURITY.md](docs/SECURITY.md#reporting-a-vulnerability).
