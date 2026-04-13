import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma, AuditAction } from '@pullenv/db'
import { SetSecretValueSchema } from '@pullenv/shared'
import { resolveUserRole } from '@/lib/membership'
import { evaluateAccess } from '@/lib/policy'
import { encrypt } from '@/lib/encryption'

// ─── Permission notes ─────────────────────────────────────────────────────────
//
// GET  — any authenticated repo member. Returns *metadata only* — version
//        numbers, timestamps, updater logins. Raw values are never included.
//        Plaintext is only available through the dedicated /reveal endpoint.
//
// POST — members with WRITE or ADMIN role. Encrypts the value server-side
//        before any DB write. The plaintext value never reaches the database.
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: { repoId: string; envId: string } }

// GET /api/repos/:repoId/environments/:envId/values
// Returns metadata for every template's current secret — no plaintext, no ciphertext.
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const env = await prisma.environment.findUnique({ where: { id: params.envId } })
  if (!env || env.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const templates = await prisma.variableTemplate.findMany({
    where: { environmentId: params.envId },
    include: {
      // Fetch only the latest version — explicitly avoid selecting encryptedVal/iv
      secretValues: {
        orderBy: { version: 'desc' },
        take: 1,
        select: {
          version: true,
          createdAt: true,
          createdBy: { select: { githubLogin: true } },
          // encryptedVal and iv are intentionally NOT selected here
        },
      },
    },
    orderBy: { key: 'asc' },
  })

  const metadata = templates.map((t) => {
    const latest = t.secretValues[0] ?? null
    return {
      templateId: t.id,
      key: t.key,
      isRequired: t.isRequired,
      description: t.description,
      defaultValue: t.defaultValue, // plaintext default — safe to expose
      hasSecret: latest !== null,
      currentVersion: latest?.version ?? null,
      updatedAt: latest?.createdAt.toISOString() ?? null,
      updatedBy: latest?.createdBy.githubLogin ?? null,
    }
  })

  return NextResponse.json(metadata)
}

// POST /api/repos/:repoId/environments/:envId/values
// Encrypts and stores a new secret version. Returns metadata, never plaintext.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Policy engine: checks WRITE permission with env-level overrides.
  // A DENY WRITE policy can block a WRITE-role user from this specific environment.
  const access = await evaluateAccess(session.user.id, params.repoId, 'WRITE', params.envId)
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden', reason: access.reason }, { status: 403 })
  }

  const env = await prisma.environment.findUnique({ where: { id: params.envId } })
  if (!env || env.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const parsed = SetSecretValueSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', message: parsed.error.message },
      { status: 400 },
    )
  }

  const { templateId, value } = parsed.data

  // Verify the template belongs to this environment (and transitively this repo)
  const template = await prisma.variableTemplate.findUnique({ where: { id: templateId } })
  if (!template || template.environmentId !== params.envId) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  // Encrypt before touching the database — plaintext never persisted
  const { ciphertext, iv } = await encrypt(params.repoId, value)

  // Determine the next version number
  const latest = await prisma.secretValue.findFirst({
    where: { templateId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const nextVersion = (latest?.version ?? 0) + 1

  // Create an immutable version row — existing versions are never modified
  const saved = await prisma.secretValue.create({
    data: {
      templateId,
      encryptedVal: ciphertext,
      iv,
      version: nextVersion,
      createdById: session.user.id,
    },
    select: {
      version: true,
      createdAt: true,
      // encryptedVal and iv explicitly excluded from response
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      repoId: params.repoId,
      environmentId: params.envId,
      action: AuditAction.SET_VAR,
      detail: { key: template.key, version: nextVersion },
    },
  })

  // Return metadata only — the stored ciphertext is not echoed back
  return NextResponse.json(
    {
      templateId,
      key: template.key,
      version: saved.version,
      updatedAt: saved.createdAt.toISOString(),
    },
    { status: 201 },
  )
}
