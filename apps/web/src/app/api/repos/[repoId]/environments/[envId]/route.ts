import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma, AuditAction } from '@pullenv/db'
import { canWrite } from '@pullenv/shared'
import { resolveUserRole } from '@/lib/membership'
import { permissionToRole } from '@/lib/github'

// ─── Permission note ──────────────────────────────────────────────────────────
// GET    — any authenticated member (READ+)
// DELETE — members with WRITE or ADMIN role only
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

  // Cascade deletes: VariableTemplates → SecretValues (via Prisma onDelete: Cascade)
  await prisma.environment.delete({ where: { id: params.envId } })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      repoId: params.repoId,
      action: AuditAction.DELETE_ENVIRONMENT,
      detail: { name: env.name },
    },
  })

  return new NextResponse(null, { status: 204 })
}
