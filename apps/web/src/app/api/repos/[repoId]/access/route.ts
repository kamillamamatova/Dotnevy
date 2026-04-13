import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { resolveUserRole } from '@/lib/membership'
import { permissionToRole } from '@/lib/github'

// GET /api/repos/:repoId/access
//
// Returns the full access picture for a repository:
//   - All members with their GitHub permission and mapped role
//   - All environments with their minRole
//   - All AccessPolicy overrides (for this repo)
//
// Any authenticated member can read the access overview.
// (Non-admins see it read-only; the mutation endpoints require ADMIN.)

type Params = { params: { repoId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [rawMembers, rawEnvs, rawPolicies] = await Promise.all([
    prisma.repoMembership.findMany({
      where: { repoId: params.repoId },
      include: { user: { select: { githubLogin: true, image: true, name: true } } },
      orderBy: { syncedAt: 'desc' },
    }),
    prisma.environment.findMany({
      where: { repoId: params.repoId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.accessPolicy.findMany({
      where: { repoId: params.repoId },
      include: { user: { select: { githubLogin: true, image: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const members = rawMembers.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    githubLogin: m.user.githubLogin,
    name: m.user.name,
    image: m.user.image,
    permission: m.permission,
    role: permissionToRole(m.permission),
    syncedAt: m.syncedAt.toISOString(),
  }))

  const environments = rawEnvs.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    minPermission: e.minPermission,
    minRole: permissionToRole(e.minPermission) ?? 'READ',
    description: e.description,
  }))

  const policies = rawPolicies.map((p) => ({
    id: p.id,
    userId: p.userId,
    githubLogin: p.user.githubLogin,
    userImage: p.user.image,
    environmentId: p.environmentId,
    action: p.action,
    effect: p.effect,
    createdAt: p.createdAt.toISOString(),
  }))

  return NextResponse.json({ members, environments, policies })
}
