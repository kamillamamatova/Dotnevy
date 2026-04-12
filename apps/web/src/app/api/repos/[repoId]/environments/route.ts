import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma, AuditAction } from '@pullenv/db'
import { CreateEnvironmentSchema, canWrite } from '@pullenv/shared'
import { resolveUserRole } from '@/lib/membership'
import { permissionToRole, roleToPermission } from '@/lib/github'

// ─── Permission note ──────────────────────────────────────────────────────────
// GET  — any authenticated member (READ+)
// POST — members with WRITE or ADMIN role only
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: { repoId: string } }

// GET /api/repos/:repoId/environments
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const environments = await prisma.environment.findMany({
    where: { repoId: params.repoId },
    include: { _count: { select: { variableTemplates: true } } },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(
    environments.map((e) => ({
      ...e,
      minRole: permissionToRole(e.minPermission) ?? 'READ',
    })),
  )
}

// POST /api/repos/:repoId/environments
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = CreateEnvironmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', message: parsed.error.message },
      { status: 400 },
    )
  }

  const { name, type, minRole, description } = parsed.data

  const existing = await prisma.environment.findUnique({
    where: { repoId_name: { repoId: params.repoId, name } },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'Conflict', message: `An environment named "${name}" already exists.` },
      { status: 409 },
    )
  }

  const env = await prisma.environment.create({
    data: {
      repoId: params.repoId,
      name,
      type,
      minPermission: roleToPermission(minRole),
      description: description ?? null,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      repoId: params.repoId,
      environmentId: env.id,
      action: AuditAction.CREATE_ENVIRONMENT,
      detail: { name },
    },
  })

  return NextResponse.json({ ...env, minRole }, { status: 201 })
}
