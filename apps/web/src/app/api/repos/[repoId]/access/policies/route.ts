import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma, AuditAction } from '@dotenvy/db'
import { CreatePolicySchema, canAdmin } from '@dotenvy/shared'
import { resolveUserRole } from '@/lib/membership'

// POST /api/repos/:repoId/access/policies
//
// Creates a fine-grained AccessPolicy override for a user in this repo.
// Requires ADMIN — this is an access control mutation.
//
// The server validates:
//   - The target user is a member of the repo (policies for non-members are meaningless)
//   - The environmentId (if provided) belongs to this repo
//   - No duplicate policy already exists for the same (userId, repoId, environmentId, action)

type Params = { params: { repoId: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canAdmin(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = CreatePolicySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', message: parsed.error.message },
      { status: 400 },
    )
  }

  const { userId, environmentId, action, effect, expiresAt, note } = parsed.data

  // Validate: target user must be a member
  const membership = await prisma.repoMembership.findUnique({
    where: { userId_repoId: { userId, repoId: params.repoId } },
  })
  if (!membership) {
    return NextResponse.json(
      { error: 'Target user is not a member of this repository' },
      { status: 422 },
    )
  }

  // Validate: environment belongs to this repo (if scoped)
  if (environmentId) {
    const env = await prisma.environment.findUnique({ where: { id: environmentId } })
    if (!env || env.repoId !== params.repoId) {
      return NextResponse.json({ error: 'Environment not found in this repository' }, { status: 404 })
    }
  }

  // Prevent duplicates: one policy per (userId, repoId, environmentId, action) combination
  const existing = await prisma.accessPolicy.findFirst({
    where: {
      userId,
      repoId: params.repoId,
      environmentId: environmentId ?? null,
      action,
    },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'A policy for this user, environment, and action already exists' },
      { status: 409 },
    )
  }

  const policy = await prisma.accessPolicy.create({
    data: {
      userId,
      repoId: params.repoId,
      membershipId: membership.id,
      environmentId: environmentId ?? null,
      action,
      effect,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      note: note ?? null,
    },
    include: { user: { select: { githubLogin: true } } },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      repoId: params.repoId,
      environmentId: environmentId ?? null,
      action: effect === 'ALLOW' ? AuditAction.GRANT_ACCESS : AuditAction.REVOKE_ACCESS,
      detail: {
        targetUser: policy.user.githubLogin,
        policyAction: action,
        effect,
        scope: environmentId ? 'environment' : 'repo',
      },
    },
  })

  return NextResponse.json(
    {
      id: policy.id,
      userId: policy.userId,
      githubLogin: policy.user.githubLogin,
      userImage: null,
      environmentId: policy.environmentId,
      action: policy.action,
      effect: policy.effect,
      expiresAt: policy.expiresAt?.toISOString() ?? null,
      note: policy.note,
      createdAt: policy.createdAt.toISOString(),
    },
    { status: 201 },
  )
}
