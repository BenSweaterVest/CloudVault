# CloudVault Deployment Guide

This guide covers deploying CloudVault to Cloudflare's free tier.

## Prerequisites

- Node.js 18 or later
- npm 9 or later
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- [GitHub account](https://github.com) (for OAuth)
- [Resend account](https://resend.com) (optional, for magic links)

## Step 1: Clone and Install

```bash
git clone https://github.com/your-org/cloudvault.git
cd cloudvault

# Install frontend dependencies
cd frontend && npm install && cd ..

# Install worker dependencies
cd worker && npm install && cd ..
```

## Step 2: Configure Cloudflare

### Install Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

### Create D1 Database

```bash
cd worker
wrangler d1 create cloudvault-db
```

Copy the `database_id` from the output and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "cloudvault-db"
database_id = "your-database-id-here"
```

### Create KV Namespace

CloudVault uses Cloudflare KV for distributed rate limiting, JWT token blacklist, and session tracking:

```bash
wrangler kv:namespace create "RATE_LIMIT"
```

Copy the `id` from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id-here"
```

### Run Database Migrations

```bash
# For production
wrangler d1 execute cloudvault-db --file=./src/db/schema.sql
```

## Step 3: Configure GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: CloudVault
   - **Homepage URL**: `https://your-app.pages.dev`
   - **Authorization callback URL**: `https://your-worker.your-subdomain.workers.dev/api/auth/github/callback`
4. Click "Register application"
5. Copy the **Client ID**
6. Click "Generate a new client secret" and copy it

## Step 4: Configure Resend (Optional)

For magic link authentication:

1. Sign up at [resend.com](https://resend.com)
2. Verify your domain or use the test domain
3. Create an API key
4. Copy the API key

## Step 5: Set Worker Secrets

```bash
cd worker

# Required
wrangler secret put GITHUB_CLIENT_ID
# Enter your GitHub Client ID

wrangler secret put GITHUB_CLIENT_SECRET
# Enter your GitHub Client Secret

wrangler secret put JWT_SECRET
# Enter a random 32+ character string (use: openssl rand -hex 32)

wrangler secret put APP_URL
# Enter your frontend URL: https://your-app.pages.dev

# Optional (for magic links)
wrangler secret put RESEND_API_KEY
# Enter your Resend API key
```

## Step 6: Deploy the Worker

```bash
cd worker
wrangler deploy
```

Note the deployed URL (e.g., `https://cloudvault-api.your-subdomain.workers.dev`).

Update your GitHub OAuth callback URL if needed.

## Step 7: Deploy the Frontend

### Option A: Cloudflare Pages Dashboard

1. Go to [Cloudflare Pages](https://dash.cloudflare.com/?to=/:account/pages)
2. Click "Create a project"
3. Connect your GitHub repository
4. Configure build settings:
   - **Framework preset**: None
   - **Build command**: `cd frontend && npm install && npm run build`
   - **Build output directory**: `frontend/dist`
5. Add environment variable:
   - `VITE_API_URL`: Your worker URL (for production builds)
6. Click "Save and Deploy"

### Option B: Wrangler CLI

```bash
cd frontend
npm run build
wrangler pages deploy dist --project-name=cloudvault
```

## Step 8: Configure Custom Domain (Optional)

### For the Frontend (Pages)

1. Go to your Pages project settings
2. Click "Custom domains"
3. Add your domain (e.g., `vault.yourorg.com`)
4. Follow DNS configuration instructions

### For the Worker

1. Go to your Worker settings
2. Click "Triggers"
3. Add a custom route (e.g., `vault.yourorg.com/api/*`)

## Step 9: Verify Deployment

1. Visit your frontend URL
2. Click "Sign in with GitHub"
3. Authorize the application
4. Set up your master password
5. Create your first organization

## Environment Variables Reference

### Worker Secrets

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth client secret |
| `JWT_SECRET` | Yes | Secret for signing JWTs (32+ chars) |
| `APP_URL` | Yes | Frontend URL for CORS and redirects |
| `RESEND_API_KEY` | No | Resend API key for magic links |

### Frontend Environment

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | API URL (only needed if not using /api proxy) |

## CI/CD with GitHub Actions

The project includes a GitHub Actions workflow (`.github/workflows/ci.yml`) that:

1. Runs linting and type checking
2. Runs tests
3. Builds the frontend
4. Deploys to Cloudflare on push to `main`

### Required GitHub Secrets

Add these in your repository settings:

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers and Pages permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

### Creating the API Token

1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click "Create Token"
3. Use "Edit Cloudflare Workers" template
4. Add "Cloudflare Pages: Edit" permission
5. Create and copy the token

## Updating the Deployment

### Deploying Updates

```bash
# Deploy worker changes
cd worker && wrangler deploy

# Deploy frontend changes
cd frontend && npm run build && wrangler pages deploy dist
```

### Database Migrations

When updating the schema:

```bash
# Apply to production
cd worker
wrangler d1 execute cloudvault-db --file=./src/db/migrations/001_add_categories.sql
```

Note: Create separate migration files for schema changes to track history.

## Monitoring

### Cloudflare Dashboard

- **Workers**: View request metrics, errors, CPU time
- **Pages**: View deployment history, build logs
- **D1**: View database size, query metrics

### Audit Logs

Access audit logs through the app (Admin > Audit Log) to monitor:
- User authentication events
- Secret access patterns
- Configuration changes

## Troubleshooting

### "CORS error" in console

Ensure `APP_URL` secret matches your frontend URL exactly.

### "Invalid token" errors

1. Check JWT_SECRET is set correctly
2. Clear browser localStorage and try again
3. Verify worker is deployed with latest code

### Database errors

```bash
# Check database exists
wrangler d1 list

# Run migrations again
wrangler d1 execute cloudvault-db --file=./src/db/schema.sql
```

### GitHub OAuth not working

1. Verify callback URL matches worker URL exactly
2. Check client ID and secret are correct
3. Ensure OAuth app is not suspended

## Backup and Recovery

### Export Data

Users can export their secrets via the app's Import/Export feature.

### Database Backup

```bash
# Export D1 database
wrangler d1 export cloudvault-db --output=backup.sql
```

### Disaster Recovery

1. Create new D1 database
2. Import backup: `wrangler d1 execute new-db --file=backup.sql`
3. Update wrangler.toml with new database ID
4. Redeploy worker

Note: Encrypted secrets remain encrypted. Users need their master passwords to access data.
