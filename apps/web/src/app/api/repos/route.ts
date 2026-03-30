import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { RegisterRepoSchema } from '@pullenv/shared'

// GET /api/repos
// Query: ?githubRemote=<url>  — used by the CLI to resolve a repo by remote URL
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const githubRemote = req.nextUrl.searchParams.get('githubRemote')

  if (githubRemote) {
    // Normalize SSH and HTTPS remote URLs to owner/name
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

  // Otherwise list repos the user is a member of
  const memberships = await prisma.repoMembership.findMany({
    where: { userId: session.user.id },
    include: { repo: true },
  })

  return NextResponse.json(memberships.map((m) => ({ ...m.repo, role: m.role })))
}

// POST /api/repos
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const result = RegisterRepoSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ error: 'Invalid input', message: result.error.message }, { status: 400 })
  }

  const repo = await prisma.repo.upsert({
    where: { githubRepoId: result.data.githubRepoId },
    create: result.data,
    update: { installationId: result.data.installationId },
  })

  return NextResponse.json(repo, { status: 201 })
}

function parseGitHubRemote(remote: string): { owner: string; name: string } | null {
  // HTTPS: https://github.com/owner/repo.git
  const https = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/)
  if (https) return { owner: https[1], name: https[2] }

  // SSH: git@github.com:owner/repo.git
  const ssh = remote.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/)
  if (ssh) return { owner: ssh[1], name: ssh[2] }

  return null
}
