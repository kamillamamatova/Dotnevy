import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { RegisterRepoSchema } from '@pullenv/shared'
import { permissionToRole } from '@/lib/github'
import { resolveRequestAuth } from '@/lib/session'

// GET /api/repos
// Returns repos the authenticated user is a member of.
// Accepts both NextAuth session cookies (web) and JWT Bearer tokens (CLI).
// Query: ?githubRemote=<url>  — used by the CLI to resolve a repo by git remote URL
export async function GET(req: NextRequest) {
  const auth = await resolveRequestAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const githubRemote = req.nextUrl.searchParams.get('githubRemote')

  if (githubRemote) {
    const parsed = parseGitHubRemote(githubRemote)
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid GitHub remote' }, { status: 400 })
    }

    const repo = await prisma.repo.findFirst({
      where: { owner: parsed.owner, name: parsed.name },
    })

    if (!repo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(repo)
  }

  const memberships = await prisma.repoMembership.findMany({
    where: { userId: auth.userId },
    include: { repo: true },
    orderBy: { repo: { updatedAt: 'desc' } },
  })

  // Map the stored GitHubPermission to the 3-tier internal role for the response
  return NextResponse.json(
    memberships.map((m) => ({ ...m.repo, role: permissionToRole(m.permission) })),
  )
}

// POST /api/repos
// Programmatic/webhook registration of a repo with a known GitHub App installation ID.
// For the web connect flow (no known installation ID), use POST /api/repos/connect instead.
// This is a web-only action (session required — CLI cannot register repos).
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const result = RegisterRepoSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ error: 'Invalid input', message: result.error.message }, { status: 400 })
  }

  // RegisterRepoSchema.installationId is the numeric GitHub App installation ID.
  // We look up the GitHubInstallation record by that ID to get the DB CUID.
  const installation = await prisma.gitHubInstallation.findUnique({
    where: { installationId: result.data.installationId },
  })
  if (!installation) {
    return NextResponse.json(
      { error: 'Installation not found', message: 'No GitHub App installation found for that ID.' },
      { status: 404 },
    )
  }

  const repo = await prisma.repo.upsert({
    where: { githubRepoId: result.data.githubRepoId },
    create: {
      githubRepoId: result.data.githubRepoId,
      owner: result.data.owner,
      name: result.data.name,
      installationId: installation.id,
    },
    update: { installationId: installation.id },
  })

  return NextResponse.json(repo, { status: 201 })
}

function parseGitHubRemote(remote: string): { owner: string; name: string } | null {
  const https = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/)
  if (https) return { owner: https[1], name: https[2] }

  const ssh = remote.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/)
  if (ssh) return { owner: ssh[1], name: ssh[2] }

  return null
}
