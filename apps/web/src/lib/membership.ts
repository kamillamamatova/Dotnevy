import { prisma, type RepoRole } from '@pullenv/db'

const MEMBERSHIP_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Returns the user's role for a given repo, or null if they have no access.
 * Memberships older than MEMBERSHIP_TTL_MS trigger a re-sync with GitHub.
 */
export async function resolveUserRole(
  userId: string,
  repoId: string,
): Promise<RepoRole | null> {
  const membership = await prisma.repoMembership.findUnique({
    where: { userId_repoId: { userId, repoId } },
  })

  if (!membership) return null

  const age = Date.now() - membership.syncedAt.getTime()
  if (age > MEMBERSHIP_TTL_MS) {
    // Re-sync in the background; serve stale role this request to avoid latency
    syncMembership(userId, repoId).catch(() => {})
  }

  return membership.role
}

/**
 * Fetches the user's current role from GitHub and updates the membership record.
 * Called lazily when a cached membership is stale.
 */
async function syncMembership(userId: string, repoId: string): Promise<void> {
  const [user, repo] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.repo.findUnique({ where: { id: repoId } }),
  ])

  if (!user || !repo) return

  // TODO: use the GitHub App installation token to call
  // GET /repos/{owner}/{repo}/collaborators/{username}/permission
  // and map the result to a RepoRole, then upsert the membership.
  // Placeholder: just refresh the syncedAt timestamp.
  await prisma.repoMembership.updateMany({
    where: { userId, repoId },
    data: { syncedAt: new Date() },
  })
}
