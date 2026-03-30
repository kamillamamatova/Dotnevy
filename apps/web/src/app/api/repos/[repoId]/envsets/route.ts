import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { CreateEnvSetSchema, canWrite } from '@pullenv/shared'
import { resolveUserRole } from '@/lib/membership'

type Params = { params: { repoId: string } }

// GET /api/repos/:repoId/envsets
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const envSets = await prisma.envSet.findMany({ where: { repoId: params.repoId } })
  return NextResponse.json(envSets)
}

// POST /api/repos/:repoId/envsets
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const result = CreateEnvSetSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ error: 'Invalid input', message: result.error.message }, { status: 400 })
  }

  const envSet = await prisma.envSet.create({
    data: { repoId: params.repoId, ...result.data },
  })

  return NextResponse.json(envSet, { status: 201 })
}
