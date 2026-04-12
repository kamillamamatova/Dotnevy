import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma, AuditAction } from '@pullenv/db'
import { UpsertEnvVarSchema, canPull, canWrite } from '@pullenv/shared'
import { resolveUserRole } from '@/lib/membership'
import { permissionToRole } from '@/lib/github'
import { decrypt, encrypt } from '@/lib/encryption'

// Legacy "vars" route — maps to VariableTemplate + SecretValue models.
// setId here is an Environment id. New code uses /api/repos/:repoId/environments/:envId/values.

type Params = { params: { repoId: string; setId: string } }

// GET /api/repos/:repoId/envsets/:setId/vars
// Returns decrypted key-value pairs for the current version of each template.
// This endpoint must only be served over HTTPS in production.
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const env = await prisma.environment.findUnique({ where: { id: params.setId } })
  if (!env || env.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const envMinRole = permissionToRole(env.minPermission) ?? 'READ'
  if (!canPull(role, envMinRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Get all templates + their latest secret value version
  const templates = await prisma.variableTemplate.findMany({
    where: { environmentId: params.setId },
    include: {
      secretValues: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  })

  const decrypted = await Promise.all(
    templates.map(async (t) => {
      const latest = t.secretValues[0]
      if (!latest) {
        return { key: t.key, value: t.defaultValue ?? '' }
      }
      return {
        key: t.key,
        value: await decrypt(params.repoId, latest.encryptedVal, latest.iv),
      }
    }),
  )

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      repoId: params.repoId,
      environmentId: params.setId,
      action: AuditAction.PULL_VARS,
    },
  })

  return NextResponse.json(decrypted, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

// PUT /api/repos/:repoId/envsets/:setId/vars
// Upserts a single variable: creates the template if absent, appends a new SecretValue version.
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const env = await prisma.environment.findUnique({ where: { id: params.setId } })
  if (!env || env.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const result = UpsertEnvVarSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', message: result.error.message },
      { status: 400 },
    )
  }

  const { key, value } = result.data
  const { ciphertext, iv } = await encrypt(params.repoId, value)

  // Ensure a template row exists for this key
  const template = await prisma.variableTemplate.upsert({
    where: { environmentId_key: { environmentId: params.setId, key } },
    create: { environmentId: params.setId, key },
    update: {},
  })

  // Append a new version (never mutate existing versions)
  const latest = await prisma.secretValue.findFirst({
    where: { templateId: template.id },
    orderBy: { version: 'desc' },
  })

  await prisma.secretValue.create({
    data: {
      templateId: template.id,
      encryptedVal: ciphertext,
      iv,
      version: (latest?.version ?? 0) + 1,
      createdById: session.user.id,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      repoId: params.repoId,
      environmentId: params.setId,
      action: AuditAction.SET_VAR,
      detail: { key },
    },
  })

  return NextResponse.json({ key })
}
