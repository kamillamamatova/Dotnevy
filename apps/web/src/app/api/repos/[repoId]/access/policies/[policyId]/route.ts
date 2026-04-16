import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma, AuditAction } from '@dotenvy/db'
import { canAdmin } from '@dotenvy/shared'
import { resolveUserRole } from '@/lib/membership'

// DELETE /api/repos/:repoId/access/policies/:policyId
//
// Removes an AccessPolicy override. Requires ADMIN.
// Deleting a DENY policy restores the user's role-based default access.
// Deleting an ALLOW policy revokes the extra access that was granted.

type Params = { params: { repoId: string; policyId: string } }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canAdmin(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const policy = await prisma.accessPolicy.findUnique({
    where: { id: params.policyId },
    include: { user: { select: { githubLogin: true } } },
  })

  if (!policy || policy.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.accessPolicy.delete({ where: { id: params.policyId } })

  // Audit log: removing an ALLOW policy is effectively revoking access;
  // removing a DENY policy is effectively restoring it.
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      repoId: params.repoId,
      environmentId: policy.environmentId ?? null,
      action:
        policy.effect === 'ALLOW' ? AuditAction.REVOKE_ACCESS : AuditAction.GRANT_ACCESS,
      detail: {
        targetUser: policy.user.githubLogin,
        removedPolicy: { action: policy.action, effect: policy.effect },
        scope: policy.environmentId ? 'environment' : 'repo',
      },
    },
  })

  return new NextResponse(null, { status: 204 })
}
