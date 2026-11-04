# Deployment

Everything below fits Cloudflare's free plan.

## What you need

- Node.js 22+
- A Cloudflare account (free)
- A GitHub OAuth app (for "Continue with GitHub"), and/or a [Resend](https://resend.com) account (free) for emailed login links. You need at least one of the two sign-in methods to work.

## 1. Install

```bash
git clone https://github.com/BenSweaterVest/CloudVault.git
cd CloudVault
(cd worker && npm install)
(cd frontend && npm install)
cd worker
npx wrangler login
```

## 2. Create the database

```bash
npx wrangler d1 create cloudvault-db
```

Copy the `database_id` into `worker/wrangler.toml`, then create the tables:

```bash
npm run db:migrate:prod
```

## 3. Decide your URLs

You need two addresses:

- **App URL**, where people open CloudVault: your Pages URL (`https://cloudvault.pages.dev`) or a custom domain (`https://vault.example.org`).
- **API URL**, where the Worker answers: `https://cloudvault-api.<your-subdomain>.workers.dev`, or a route on your own domain.

If you put the Worker on the same hostname as the app under `/api/*` (a Worker route on a custom domain), the frontend needs no API configuration. Otherwise set `VITE_API_URL` when building the frontend (step 6).

## 4. Configure sign-in

**GitHub:** create an OAuth app at GitHub Settings > Developer settings > OAuth Apps.

- Homepage URL: your App URL
- Authorization callback URL: `<App URL>/auth/github/callback`

**Magic links:** create a Resend API key and verify a sending domain.

## 5. Set secrets and deploy the Worker

```bash
npx wrangler secret put JWT_SECRET            # 32+ random characters, e.g. `openssl rand -base64 48`
npx wrangler secret put APP_URL               # e.g. https://vault.example.org
npx wrangler secret put GITHUB_CLIENT_ID      # if using GitHub sign-in
npx wrangler secret put GITHUB_CLIENT_SECRET  # if using GitHub sign-in
npx wrangler secret put RESEND_API_KEY        # if using emailed login links
npx wrangler secret put EMAIL_FROM            # optional, e.g. "CloudVault <vault@example.org>"
```

In `wrangler.toml`, set `ENVIRONMENT = "production"`. Once your team has joined, consider `ALLOW_SIGNUPS = "false"` so only invited people can sign in.

```bash
npm run deploy
```

The login screen only shows the sign-in methods you configured.

## 6. Deploy the frontend

```bash
cd ../frontend
VITE_API_URL=https://cloudvault-api.<your-subdomain>.workers.dev/api npm run build
npx wrangler pages deploy dist --project-name cloudvault
```

The build writes `dist/_headers`, which Pages applies: a strict Content Security Policy that only allows connections to the app and the API origin, plus other security headers.

## 7. First run

1. Open the App URL and sign in.
2. Create your master password and write it down somewhere safe. It cannot be recovered.
3. Create an organization, add items or import them (Import / Export).
4. Invite people from Members. When they have set up their master password, approve them after comparing key fingerprints on a call.
5. Optionally add an emergency contact under Settings.

## Automatic deploys (GitHub Actions)

`.github/workflows/ci.yml` tests every push and pull request. On pushes to `main` it also deploys, if these are configured in the repository settings:

| Kind | Name | Value |
|------|------|-------|
| Secret | `CLOUDFLARE_API_TOKEN` | Token with Workers Scripts, D1 and Pages edit permissions |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Your account id |
| Variable | `VITE_API_URL` | The Worker's `/api` URL (omit if same-origin) |
| Variable | `PAGES_PROJECT_NAME` | Pages project name (default `cloudvault`) |

The deploy job applies D1 migrations before deploying the Worker. Worker secrets (step 5) are set once with wrangler and are not stored in GitHub.

## Updating

```bash
git pull
cd worker && npm ci && npm run db:migrate:prod && npm run deploy
cd ../frontend && npm ci && npm run build && npx wrangler pages deploy dist --project-name cloudvault
```

Always apply migrations before deploying a new Worker version.

## Upgrading from 0.2.x

See the [changelog upgrade notes](../CHANGELOG.md#upgrading-from-02x). In short: `npm run db:migrate:prod` (the first migration is a no-op on an existing database), remove the KV binding, redeploy both parts. Everyone is signed out once.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Every request returns 503 "not configured correctly" | Check `wrangler tail`: a required secret is missing, `JWT_SECRET` is shorter than 32 characters, or `APP_URL` is not a URL |
| Browser console shows CORS errors | `APP_URL` must exactly match the origin people use (scheme and host, no path) |
| Requests are blocked by Content Security Policy | Rebuild the frontend with the correct `VITE_API_URL` |
| GitHub sign-in says "could not be verified" | Start from the login page in the same browser tab; check the OAuth callback URL |
| Magic link emails don't arrive | Check the Resend dashboard and sending domain; links are not printed when `ENVIRONMENT = "production"` |
| "Too many requests" | Rate limits reset within 1 to 15 minutes |
