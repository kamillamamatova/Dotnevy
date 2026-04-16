# Dotenvy

Dotenvy is a GitHub-native developer onboarding tool that helps teams securely manage shared environment variables for local development.

**Core workflow:** a developer joins a repo, logs in with GitHub, gets access based on their repo role, and runs `dotenvy pull` to get the correct env vars into `.env.local` — without teammates manually sending secrets.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  apps/web  (Next.js 15 + Tailwind)                      │
│  ├── GitHub OAuth via next-auth                         │
│  ├── REST API (env var CRUD, CLI token issuance)        │
│  └── Dashboard UI                                       │
├─────────────────────────────────────────────────────────┤
│  packages/db       Prisma schema + PrismaClient         │
│  packages/shared   Zod schemas, types, RBAC helpers     │
│  packages/cli      `dotenvy` CLI published to npm       │
└─────────────────────────────────────────────────────────┘
              │
         PostgreSQL
```

**Security highlights:**
- Env var values encrypted at rest with AES-256-GCM, per-repo data encryption keys
- Per-repo DEKs are themselves encrypted with a server master key
- CLI uses short-lived JWTs (15 min) with long-lived refresh tokens stored at `~/.dotenvy/credentials.json` (mode 600)
- GitHub role checked on first access, cached with 1-hour TTL, invalidated via webhook on membership changes

---

## Packages

| Package | Purpose |
|---|---|
| `apps/web` | Next.js dashboard and API server |
| `packages/db` | Prisma schema, migrations, and PrismaClient singleton |
| `packages/shared` | Zod validation schemas, TypeScript types, RBAC permission helpers |
| `packages/cli` | `dotenvy` CLI: `login`, `pull`, `whoami`, `logout` |

---

## Setup

### Prerequisites

- Node.js >= 20
- PostgreSQL
- A [GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps) with:
  - Repository permissions: `Members` (read)
  - Webhook events: `Member`
  - OAuth callback URL: `http://localhost:3000/api/auth/callback/github`
  - CLI auth callback URL: `http://localhost:3000/cli-auth`

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp apps/web/.env.example apps/web/.env.local
```

Fill in the values in `.env.local`:

```
DATABASE_URL=postgresql://...
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<openssl rand -base64 32>
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_WEBHOOK_SECRET=...
MASTER_ENCRYPTION_KEY=<openssl rand -base64 32>
CLI_JWT_SECRET=<openssl rand -base64 32>
```

### 3. Set up the database

```bash
npm run db:generate   # generate Prisma client
npm run db:push       # push schema to DB (dev only)
```

### 4. Run locally

```bash
npm run dev
```

---

## CLI Usage

```bash
npm install -g dotenvy

dotenvy login           # authenticate via browser
dotenvy pull            # pull development env vars into .env.local
dotenvy pull --env staging --output .env.staging
dotenvy whoami          # show current user and token info
dotenvy logout
```

---

## Roadmap

**Phase 1 (done):** Monorepo scaffold, Prisma schema, shared types
**Phase 2:** GitHub App OAuth, session auth, membership sync
**Phase 3:** Env var encryption, CRUD API, dashboard UI
**Phase 4:** CLI login (device flow) + pull command
**Phase 5:** Rate limiting, webhook hardening, npm publish

Future (post-MVP):
- OS keychain integration for CLI credentials
- Secret rotation UI
- Audit log viewer in dashboard
- Self-hosted deployment guide
