import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma, AuditAction, GitHubPermission } from '@pullenv/db'
import { z } from 'zod'
import { getRepoInfo } from '@/lib/github'

// ─── Connect flow notes ───────────────────────────────────────────────────────
//
// This endpoint handles the manual repo-connect flow from the web UI.
// It differs from POST /api/repos in that no real GitHub App installation ID
// is required. Instead it creates (or reuses) a placeholder GitHubInstallation
// row so the Repo FK constraint is satisfied.
//
// Placeholder installations use installationId = -(user.githubId).
//   - Negative IDs are never issued by GitHub (GitHub uses positive integers)
//   - One placeholder per GitHub user account
//   - When a real App installation arrives via webhook, the repo's installationId
//     can be migrated to the real installation's DB id
//
// Why ADMIN for the connecting user?
//   The person connecting the repo is declaring Pullenv access for it. Granting
//   ADMIN matches GitHub's own "if you can connect a service integration, you're
//   an admin" model. Real permission levels are synced from GitHub once an App
//   installation is in place.
// ─────────────────────────────────────────────────────────────────────────────

const ConnectRepoSchema = z.object({
  owner: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  // Optional: client can provide the numeric GitHub repo ID to skip the public
  // API lookup (required for private repos before GitHub App is installed).
  githubRepoId: z.number().int().positive().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = ConnectRepoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', message: parsed.error.message },
      { status: 400 },
    )
  }

  const { owner, name } = parsed.data
  let githubRepoId = parsed.data.githubRepoId
  let isPrivate = true

  // Resolve the numeric GitHub repo ID if not provided.
  // This only works for public repos — for private repos the client must supply it.
  if (!githubRepoId) {
    const info = await getRepoInfo(owner, name)
    if (!info) {
      return NextResponse.json(
        {
          error: 'Repo not found',
          message:
            'Could not fetch repo info from GitHub. If this is a private repo, provide the numeric GitHub repo ID.',
        },
        { status: 422 },
      )
    }
    githubRepoId = info.id
    isPrivate = info.private
  }

  // Load the connecting user's GitHub identity
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { githubId: true, githubLogin: true },
  })
  if (!user?.githubId) {
    return NextResponse.json({ error: 'GitHub identity not found on user record' }, { status: 400 })
  }

  // Find or create the placeholder installation for this user's GitHub account
  const placeholderInstallationId = -user.githubId
  const installation = await prisma.gitHubInstallation.upsert({
    where: { installationId: placeholderInstallationId },
    create: {
      installationId: placeholderInstallationId,
      accountLogin: user.githubLogin ?? owner,
      accountType: 'User',
      targetId: user.githubId,
    },
    update: {}, // already exists — no changes needed
  })

  // Check if this repo is already registered
  let repo = await prisma.repo.findUnique({ where: { githubRepoId } })

  if (!repo) {
    repo = await prisma.repo.create({
      data: {
        githubRepoId,
        owner,
        name,
        private: isPrivate,
        installationId: installation.id,
      },
    })
  }

  // Grant the connecting user ADMIN on this repo.
  // Re-synced from GitHub once a real App installation is configured.
  await prisma.repoMembership.upsert({
    where: { userId_repoId: { userId: session.user.id, repoId: repo.id } },
    create: {
      userId: session.user.id,
      repoId: repo.id,
      permission: GitHubPermission.ADMIN,
    },
    update: {
      permission: GitHubPermission.ADMIN,
      syncedAt: new Date(),
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      repoId: repo.id,
      action: AuditAction.REGISTER_REPO,
    },
  })

  return NextResponse.json(repo, { status: 201 })
}
