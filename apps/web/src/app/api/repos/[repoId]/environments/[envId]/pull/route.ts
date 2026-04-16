import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pullenv/db'
import { evaluateAccess } from '@/lib/policy'
import { decrypt } from '@/lib/encryption'
import { logAudit } from '@/lib/audit'
import { resolveRequestAuth } from '@/lib/session'
import type { PullEnvResponse, PullVariable, SkippedVariable } from '@pullenv/shared'

// ─── Pull endpoint ────────────────────────────────────────────────────────────
//
// GET /api/repos/:repoId/environments/:envId/pull
//
// This is the *killer feature* endpoint — it decrypts and returns every
// variable the authenticated user is allowed to pull for a given environment,
// structured for direct use as a local .env.local file.
//
// ── Authentication ────────────────────────────────────────────────────────────
//
// Accepts two auth methods:
//   1. NextAuth session cookie  (web UI, "copy all" / export)
//   2. JWT Bearer token         (CLI, issued by POST /api/tokens/cli)
//
// Both methods funnel through the same policy engine — the JWT is only used
// to identify the user (sub claim). The role check always hits the database
// so live access changes are respected.
//
// ── Authorization ─────────────────────────────────────────────────────────────
//
// Uses evaluateAccess(userId, repoId, 'PULL', envId) which:
//   - Checks RepoMembership exists
//   - Live re-syncs GitHub membership for PRODUCTION environments
//   - Applies explicit DENY/ALLOW AccessPolicy overrides
//   - Falls back to role vs env.minPermission check
//
// If access is denied the endpoint returns 403 — the CLI should surface
// the reason string to the user.
//
// ── Response ──────────────────────────────────────────────────────────────────
//
// Returns PullEnvResponse with:
//   - variables: decrypted key-value pairs the user can pull
//   - skipped:   templates with no value set or skipped by policy (with reason)
//   - meta:      context for CLI output and .env.local generation
//
// Non-secret templates with a defaultValue (e.g. PORT=3000) are included in
// variables — they don't need a SecretValue row to be useful locally.
//
// All responses carry Cache-Control: no-store.
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: { repoId: string; envId: string } }

export async function GET(req: NextRequest, { params }: Params) {
  // ── 1. Auth resolution ───────────────────────────────────────────────────
  const auth = await resolveRequestAuth(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { userId, source } = auth

  // ── 2. Policy evaluation ─────────────────────────────────────────────────
  // The policy engine enforces: membership, live GitHub re-sync for PRODUCTION,
  // explicit AccessPolicy overrides, and role vs env.minPermission fallback.
  const access = await evaluateAccess(userId, params.repoId, 'PULL', params.envId)
  if (!access.allowed) {
    return NextResponse.json(
      { error: 'Forbidden', reason: access.reason },
      { status: 403 },
    )
  }

  // ── 3. Fetch repo + environment metadata ─────────────────────────────────
  const [repo, env] = await Promise.all([
    prisma.repo.findUnique({ where: { id: params.repoId } }),
    prisma.environment.findUnique({ where: { id: params.envId } }),
  ])

  if (!repo || !env || env.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // ── 4. Fetch all templates with their latest SecretValue ─────────────────
  const templates = await prisma.variableTemplate.findMany({
    where: { environmentId: params.envId },
    orderBy: { key: 'asc' },
    include: {
      secretValues: {
        orderBy: { version: 'desc' },
        take: 1,
        select: { encryptedVal: true, iv: true, version: true },
      },
    },
  })

  // ── 5. Decrypt and categorize ─────────────────────────────────────────────
  const variables: PullVariable[] = []
  const skipped: SkippedVariable[] = []

  await Promise.all(
    templates.map(async (template) => {
      const latest = template.secretValues[0] ?? null

      if (latest) {
        // Has a secret value — decrypt it
        const value = await decrypt(params.repoId, latest.encryptedVal, latest.iv)
        variables.push({
          key: template.key,
          value,
          version: latest.version,
          isRequired: template.isRequired,
          description: template.description,
        })
      } else if (template.defaultValue != null) {
        // No secret set but has a non-secret default (e.g. PORT=3000) — include it
        variables.push({
          key: template.key,
          value: template.defaultValue,
          version: null,              // null signals "came from defaultValue"
          isRequired: template.isRequired,
          description: template.description,
        })
      } else {
        // No value and no default — skip and report
        skipped.push({
          key: template.key,
          isRequired: template.isRequired,
          reason: 'no_secret_set',
        })
      }
    }),
  )

  // Sort variables alphabetically (Promise.all order is non-deterministic)
  variables.sort((a, b) => a.key.localeCompare(b.key))
  skipped.sort((a, b) => a.key.localeCompare(b.key))

  // ── 6. Audit log — one entry for the entire pull ──────────────────────────
  await logAudit({
    userId,
    repoId: params.repoId,
    environmentId: params.envId,
    event: {
      action: 'PULL_VARS',
      detail: {
        keys: variables.map((v) => v.key),
        variableCount: variables.length,
        skippedCount: skipped.length,
        environmentName: env.name,
        source: (source ?? 'web') as 'cli' | 'web',
      },
    },
  })

  // ── 7. Build and return the response ─────────────────────────────────────
  const body: PullEnvResponse = {
    meta: {
      repoId: params.repoId,
      repoFullName: `${repo.owner}/${repo.name}`,
      environmentId: params.envId,
      environment: env.name,
      environmentType: env.type,
      pulledAt: new Date().toISOString(),
      variableCount: variables.length,
      skippedCount: skipped.length,
      source: (source ?? 'web') as 'cli' | 'web',
    },
    variables,
    skipped,
  }

  return NextResponse.json(body, {
    headers: {
      // Prevent caching of decrypted secrets at every layer
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    },
  })
}

