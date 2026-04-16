import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@dotenvy/db'
import { resolveUserRole } from '@/lib/membership'

type Params = { params: { repoId: string } }

// GET /api/repos/:repoId
// Returns the repo with the requesting user's role.
// Used by the CLI and programmatic clients; the web UI reads directly from the DB.
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const repo = await prisma.repo.findUnique({ where: { id: params.repoId } })
  if (!repo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ...repo, role })
}
