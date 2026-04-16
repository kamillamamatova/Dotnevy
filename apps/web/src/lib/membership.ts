import { prisma, GitHubPermission } from '@dotenvy/db'
import type { RepoRole } from '@dotenvy/shared'
import { permissionToRole, getInstallationToken, getCollaboratorPermission } from '@/lib/github'

const MEMBERSHIP_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Returns the user's internal 3-tier role for a repo, or null if they have no
 * membership row (i.e. no access at all).
 *
 * Serves the cached GitHubPermission from the DB and maps it to a RepoRole.
 * When the cached value is older than MEMBERSHIP_TTL_MS, a background re-sync
 * is triggered so the next request gets fresh data without blocking this one.
 */
export async function resolveUserRole(userId: string, repoId: string): Promise<RepoRole | null> {
  const membership = await prisma.repoMembership.findUnique({
    where: { userId_repoId: { userId, repoId } },
  })

  if (!membership) return null

  const age = Date.now() - membership.syncedAt.getTime()
  if (age > MEMBERSHIP_TTL_MS) {
    syncMembership(userId, repoId).catch(() => {})
  }

  return permissionToRole(membership.permission)
}

/**
 * Fetches the current GitHub permission for a single user and updates the DB.
 *
 * Graceful no-ops (only refreshes syncedAt) when:
 *   - The repo's installation is a placeholder (installationId ≤ 0)
 *   - GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY env vars are absent
 *
 * Hard actions:
 *   - NONE returned → membership deleted (user removed from repo)
 *   - Any other permission → upserted with fresh syncedAt
 *
 * This function is intentionally fire-and-forget safe: exceptions are caught
 * by the background caller (`.catch(() => {})`).
 */
export async function syncMembership(userId: string, repoId: string): Promise<void> {
  const [user, repo] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.repo.findUnique({
      where: { id: repoId },
      include: { installation: true },
    }),
  ])

  if (!user?.githubLogin || !repo) return

  const token = await getInstallationToken(repo.installation.installationId)

  if (!token) {
    // App not configured or placeholder installation — bump timestamp to avoid
    // re-triggering the sync on every request until credentials are set up.
    await prisma.repoMembership.updateMany({
      where: { userId, repoId },
      data: { syncedAt: new Date() },
    })
    return
  }

  const permission = await getCollaboratorPermission(
    token,
    repo.owner,
    repo.name,
    user.githubLogin,
  )

  if (permission === GitHubPermission.NONE) {
    // User has been removed — delete the membership so they lose access immediately
    await prisma.repoMembership.deleteMany({ where: { userId, repoId } })
  } else {
    await prisma.repoMembership.upsert({
      where: { userId_repoId: { userId, repoId } },
      create: { userId, repoId, permission },
      update: { permission, syncedAt: new Date() },
    })
  }
}

/**
 * Re-syncs every existing membership for a repo from GitHub.
 * Call this when significant access events occur (GitHub App installation
 * updated, repo transferred, etc.).
 *
 * Note: this only refreshes memberships for users already in the DB. It does
 * not discover new collaborators. Full collaborator discovery requires a call
 * to GET /repos/{owner}/{repo}/collaborators with an installation token and is
 * left for the GitHub App installation webhook handler.
 */
export async function syncRepoMemberships(repoId: string): Promise<void> {
  const memberships = await prisma.repoMembership.findMany({ where: { repoId } })
  await Promise.allSettled(memberships.map((m) => syncMembership(m.userId, repoId)))
}
