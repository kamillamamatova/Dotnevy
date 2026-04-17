import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma, AuditAction } from '@dotenvy/db'
import { canWrite } from '@dotenvy/shared'
import { resolveUserRole } from '@/lib/membership'

// ─── Import endpoint ──────────────────────────────────────────────────────────
//
// POST /api/repos/:repoId/environments/:envId/templates/import
//
// Parses the raw text content of a .env.example file and bulk-creates
// VariableTemplate records for any keys that don't already exist.
//
// Values are intentionally NOT stored — importing only creates the key
// template (name + metadata). Actual secret values must be set separately
// via the Set Value UI or via `dotenvy pull`. This avoids accidentally
// persisting real secrets that may appear in .env.example files.
//
// Parsing rules:
//   - Lines starting with `#` → skipped (comments)
//   - Empty/whitespace-only lines → skipped
//   - `export KEY=value` → key extracted, export prefix stripped
//   - `KEY=value` or `KEY=` or `KEY` → key extracted
//   - Keys not matching UPPER_SNAKE_CASE ([A-Z_][A-Z0-9_]*) → skipped
//   - Keys that already exist in the environment → counted in `skipped`
//
// Permission: WRITE+
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: { repoId: string; envId: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const env = await prisma.environment.findUnique({ where: { id: params.envId } })
  if (!env || env.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const content: unknown = body?.content
  if (typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  const parsedKeys = parseEnvExample(content)
  if (parsedKeys.length === 0) {
    return NextResponse.json(
      { error: 'No valid variable keys found in the provided content.' },
      { status: 400 },
    )
  }

  // Find which keys already exist in this environment
  const existing = await prisma.variableTemplate.findMany({
    where: { environmentId: params.envId },
    select: { key: true },
  })
  const existingKeys = new Set(existing.map((t) => t.key))

  const toCreate = parsedKeys.filter((k) => !existingKeys.has(k))
  const skipped = parsedKeys.filter((k) => existingKeys.has(k))

  if (toCreate.length === 0) {
    return NextResponse.json({ created: [], skipped })
  }

  // Create all new templates
  const created = await Promise.all(
    toCreate.map((key) =>
      prisma.variableTemplate.create({
        data: { environmentId: params.envId, key, isRequired: false },
      }),
    ),
  )

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      repoId: params.repoId,
      environmentId: params.envId,
      action: AuditAction.IMPORT_TEMPLATES,
      detail: {
        keys: toCreate,
        count: toCreate.length,
        skippedCount: skipped.length,
        environmentName: env.name,
      },
    },
  })

  return NextResponse.json(
    {
      created: created.map((t) => ({
        id: t.id,
        key: t.key,
        description: null,
        isRequired: false,
        defaultValue: null,
        hasSecret: false,
        currentVersion: null,
        updatedAt: null,
        updatedBy: null,
      })),
      skipped,
    },
    { status: 201 },
  )
}

// ─── Parser ───────────────────────────────────────────────────────────────────

const KEY_RE = /^[A-Z_][A-Z0-9_]*$/

function parseEnvExample(content: string): string[] {
  const seen = new Set<string>()
  const keys: string[] = []

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    // Strip optional `export ` prefix
    const stripped = line.startsWith('export ') ? line.slice(7).trimStart() : line

    // Extract everything before the first `=` (or the whole token if no `=`)
    const eqIdx = stripped.indexOf('=')
    const rawKey = (eqIdx >= 0 ? stripped.slice(0, eqIdx) : stripped).trim().toUpperCase()

    if (!KEY_RE.test(rawKey) || seen.has(rawKey)) continue
    seen.add(rawKey)
    keys.push(rawKey)
  }

  return keys
}
