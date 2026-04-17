# Dotenvy

Dotenvy is a GitHub-native developer onboarding tool that helps teams securely manage shared environment variables for local development.

**Core workflow:** a developer joins a repo, logs in with GitHub, gets access based on their repo role, and runs `dotenvy pull` to get the correct env vars into `.env.local` — without teammates manually sending secrets.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  apps/web  (Next.js 15 App Router + Tailwind)           │
│  ├── GitHub OAuth via next-auth                         │
│  ├── REST API (env CRUD, secret management, CLI tokens) │
│  └── Dashboard UI (repos, environments, access, audit)  │
├─────────────────────────────────────────────────────────┤
│  packages/db       Prisma schema + PrismaClient         │
│  packages/shared   Zod schemas, types, RBAC helpers     │
│  packages/cli      `dotenvy` CLI published to npm       │
└─────────────────────────────────────────────────────────┘
              │
         PostgreSQL
```

### Key modules

| File | Purpose |
|------|---------|
| `apps/web/src/lib/encryption.ts` | Envelope encryption service (AES-256-GCM, per-repo DEKs) |
| `apps/web/src/lib/policy.ts` | 4-layer access policy engine |
| `apps/web/src/lib/membership.ts` | GitHub membership sync with 1-hour cache |
| `apps/web/src/lib/cli-auth.ts` | CLI JWT verification |
| `apps/web/src/app/api/env/[repoId]/[envId]/pull/route.ts` | Core secret pull endpoint (dual auth: session + JWT) |
| `apps/web/src/app/api/tokens/cli/route.ts` | CLI device-flow auth (PUT/GET/POST) |
| `packages/shared/src/permissions/` | Pure RBAC helpers (`canPull`, `canWrite`, `canAdmin`) |

### Security highlights

- **Envelope encryption**: per-repo AES-256-GCM data encryption keys (DEKs) wrapped by a server master key. Swap `getRepoDek()` to KMS with zero schema changes.
- **Auth tag integrity**: GCM auth tag (16 bytes) is appended to ciphertext; tampering causes decryption to throw.
- **CLI device flow**: CLI pre-registers a UUID state → browser claims it → CLI polls for token. State expires in 10 minutes.
- **Dual auth on pull**: accepts both session cookies (web) and short-lived JWT Bearer tokens (CLI, 15-min TTL with 30-day refresh).
- **4-layer policy engine**: membership check → live GitHub re-sync (PRODUCTION/ADMIN) → explicit AccessPolicy overrides (with expiry) → role-based fallback.
- **Audit trail**: every secret reveal, write, import, and access change is logged with typed `AuditAction` enum values. Plaintext values are never logged.
- **Fail-fast env validation**: `MASTER_ENCRYPTION_KEY` and `CLI_JWT_SECRET` are validated at module load, not lazily on first use.

### RBAC roles

| GitHub permission | Internal role | Can pull (READ env) | Can pull (WRITE env) | Can pull (ADMIN env) | Can write vars | Can admin |
|---|---|---|---|---|---|---|
| read / triage | READ | ✓ | | | | |
| write / maintain | WRITE | ✓ | ✓ | | ✓ | |
| admin | ADMIN | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## Packages

| Package | Purpose |
|---|---|
| `apps/web` | Next.js dashboard and API server |
| `packages/db` | Prisma schema, migrations, and PrismaClient singleton |
| `packages/shared` | Zod validation schemas, TypeScript types, RBAC permission helpers |
| `packages/cli` | `dotenvy` CLI: `login`, `pull`, `whoami`, `logout` |

---

## Local setup

### Prerequisites

- Node.js >= 20
- PostgreSQL (local or remote)
- A [GitHub App](https://docs.github.com/en/apps/creating-github-apps) with:
  - **Repository permissions**: `Members` (read)
  - **Webhook events**: `Member`, `Repository`
  - **OAuth callback URL**: `http://localhost:3000/api/auth/callback/github`

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp apps/web/.env.example apps/web/.env.local
```

Generate secrets and fill in `apps/web/.env.local`:

```bash
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/dotenvy

# Next Auth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=$(openssl rand -base64 32)

# GitHub App OAuth credentials (from your App's settings page)
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# GitHub App (for membership sync — optional in dev, graceful fallback)
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=$(openssl rand -base64 32)

# Encryption — MUST be set or the server refuses to start
MASTER_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
CLI_JWT_SECRET=$(openssl rand -base64 32)
```

> **Important:** `MASTER_ENCRYPTION_KEY` and `CLI_JWT_SECRET` have no fallback. The server
> throws at startup if either is missing. Keep your production values in a secrets manager.

### 3. Set up the database

```bash
npm run db:generate   # generate Prisma client from schema
npm run db:push       # apply schema to DB (dev only — use db:migrate in production)
```

### 4. Run the dev server

```bash
npm run dev           # starts apps/web on http://localhost:3000
```

### 5. Run tests

```bash
npm test              # runs all package tests via turbo
```

Or per package:

```bash
cd packages/shared && npx vitest run   # permission logic tests
cd apps/web && npx vitest run          # encryption + policy tests
```

---

## CLI Usage

```bash
npm install -g dotenvy

dotenvy login                                  # authenticate via browser
dotenvy pull                                   # pull vars from default (dev) env into .env.local
dotenvy pull --env staging --output .env.staging
dotenvy whoami                                 # show current user and token info
dotenvy logout
```

Config file written to `~/.dotenvy/credentials.json` (mode 600). Override API base with `DOTENVY_API_BASE` env var.

---

## Webhook setup (optional but recommended)

Configure your GitHub App's webhook to point to `https://your-domain.com/api/github/webhook`.

Handled events:
- **`member`** — syncs permission changes and removes revoked members
- **`repository`** — handles repo renames, visibility changes, and deletions

Set `GITHUB_APP_WEBHOOK_SECRET` to the same value configured in the App settings.

---

## What's implemented

- GitHub OAuth login + session management
- GitHub App membership sync (cached, webhook-invalidated)
- Repo connect (via App installation or manual)
- Environment CRUD with types (development / staging / production / custom) and per-env pull minimums
- Variable templates + encrypted secret values with immutable versioning
- Version history UI per variable
- Import variable templates from `.env.example`
- Missing required variable detection banner
- CLI device-flow login + JWT access/refresh tokens
- `dotenvy pull` — bulk secret fetch, decrypts and writes `.env.local`
- Access management: per-user policy overrides with expiry and notes
- Audit trail: typed log of every sensitive action
- Webhook handler for membership and repository events
