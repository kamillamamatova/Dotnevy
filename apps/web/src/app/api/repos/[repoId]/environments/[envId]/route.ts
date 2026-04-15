import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { canWrite, canAdmin, UpdateEnvironmentSchema } from '@pullenv/shared'
import { resolveUserRole } from '@/lib/membership'
import { permissionToRole, roleToPermission } from '@/lib/github'
import { logAudit } from '@/lib/audit'

// ─── Permission note ──────────────────────────────────────────────────────────
// GET    — any authenticated member (READ+)
// PATCH  — ADMIN role only (changing minPermission is an access control action)
// DELETE — WRITE or ADMIN role only
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: { repoId: string; envId: string } }

// GET /api/repos/:repoId/environments/:envId
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const env = await prisma.environment.findUnique({
    where: { id: params.envId },
    include: { _count: { select: { variableTemplates: true } } },
  })

  if (!env || env.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ ...env, minRole: permissionToRole(env.minPermission) ?? 'READ' })
}

// PATCH /api/repos/:repoId/environments/:envId
// Updates environment access settings (minPermission, description).
// Requires ADMIN — changing who can pull from an environment is an access control action.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canAdmin(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const env = await prisma.environment.findUnique({ where: { id: params.envId } })
  if (!env || env.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const parsed = UpdateEnvironmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', message: parsed.error.message },
      { status: 400 },
    )
  }

  const { minRole, description } = parsed.data
  const updated = await prisma.environment.update({
    where: { id: params.envId },
    data: {
      ...(minRole !== undefined && { minPermission: roleToPermission(minRole) }),
      ...(description !== undefined && { description }),
    },
  })

  const changes: Array<'minRole' | 'description'> = []
  if (minRole !== undefined) changes.push('minRole')
  if (description !== undefined) changes.push('description')

  if (changes.length > 0) {
    await logAudit({
      userId: session.user.id,
      repoId: params.repoId,
      environmentId: params.envId,
      event: {
        action: 'UPDATE_ENVIRONMENT',
        detail: {
          name: env.name,
          changes,
          ...(minRole !== undefined && { newMinRole: minRole }),
        },
      },
    })
  }

  return NextResponse.json({ ...updated, minRole: permissionToRole(updated.minPermission) ?? 'READ' })
}

// DELETE /api/repos/:repoId/environments/:envId
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const env = await prisma.environment.findUnique({ where: { id: params.envId } })
  if (!env || env.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Count templates before cascade so the audit record is informative
  const templateCount = await prisma.variableTemplate.count({
    where: { environmentId: params.envId },
  })

  // Cascade deletes: VariableTemplates → SecretValues (via Prisma onDelete: Cascade)
  await prisma.environment.delete({ where: { id: params.envId } })

  await logAudit({
    userId: session.user.id,
    repoId: params.repoId,
    event: {
      action: 'DELETE_ENVIRONMENT',
      detail: { name: env.name, type: env.type, templateCount },
    },
  })

  return new NextResponse(null, { status: 204 })
}
