import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pullenv/db'
import { permissionToRole } from '@/lib/github'
import { resolveRequestAuth } from '@/lib/session'

// GET /api/repos/by-slug/:owner/:name
// Resolves a repo by its owner/name slug and returns it with the caller's role.
// Accepts both session cookies (web) and JWT Bearer (CLI).
// Returns 404 if the repo is not registered, 403 if the caller has no membership.

type Params = { params: { owner: string; name: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await resolveRequestAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await prisma.repo.findFirst({
    where: {
      owner: { equals: params.owner, mode: 'insensitive' },
      name: { equals: params.name, mode: 'insensitive' },
    },
  })

  if (!repo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Verify the caller is a member
  const membership = await prisma.repoMembership.findUnique({
    where: { userId_repoId: { userId: auth.userId, repoId: repo.id } },
  })

  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({
    id: repo.id,
    owner: repo.owner,
    name: repo.name,
    role: permissionToRole(membership.permission),
  })
}
