import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma, AuditAction } from '@dotenvy/db'
import { CreateEnvSetSchema, canWrite } from '@dotenvy/shared'
import { resolveUserRole } from '@/lib/membership'
import { permissionToRole, roleToPermission } from '@/lib/github'

// Legacy "envsets" route — maps to the Environment model.
// New code should use /api/repos/:repoId/environments instead.
// This route is kept for CLI backward compatibility.

type Params = { params: { repoId: string } }

// GET /api/repos/:repoId/envsets
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const environments = await prisma.environment.findMany({
    where: { repoId: params.repoId },
    orderBy: { createdAt: 'asc' },
  })

  // Shape the response as the legacy EnvSet format for CLI compatibility
  return NextResponse.json(
    environments.map((e) => ({
      id: e.id,
      repoId: e.repoId,
      name: e.name,
      minRole: permissionToRole(e.minPermission) ?? 'READ',
      createdAt: e.createdAt,
    })),
  )
}

// POST /api/repos/:repoId/envsets
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const result = CreateEnvSetSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', message: result.error.message },
      { status: 400 },
    )
  }

  const { name, minRole } = result.data

  const existing = await prisma.environment.findUnique({
    where: { repoId_name: { repoId: params.repoId, name } },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'Conflict', message: `Environment "${name}" already exists.` },
      { status: 409 },
    )
  }

  const env = await prisma.environment.create({
    data: {
      repoId: params.repoId,
      name,
      minPermission: roleToPermission(minRole),
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

  return NextResponse.json({ id: env.id, repoId: env.repoId, name: env.name, minRole, createdAt: env.createdAt }, { status: 201 })
}
