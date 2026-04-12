import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { CreateTemplateSchema, canWrite } from '@pullenv/shared'
import { resolveUserRole } from '@/lib/membership'

// ─── Permission note ──────────────────────────────────────────────────────────
// GET  — any authenticated member (READ+)
// POST — members with WRITE or ADMIN role only
//
// Key names are immutable after creation. Description, isRequired, and
// defaultValue are editable via PATCH on the individual template route.
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: { repoId: string; envId: string } }

// GET /api/repos/:repoId/environments/:envId/templates
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Verify the environment belongs to the repo
  const env = await prisma.environment.findUnique({ where: { id: params.envId } })
  if (!env || env.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const templates = await prisma.variableTemplate.findMany({
    where: { environmentId: params.envId },
    orderBy: { key: 'asc' },
  })

  return NextResponse.json(templates)
}

// POST /api/repos/:repoId/environments/:envId/templates
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Verify the environment belongs to the repo
  const env = await prisma.environment.findUnique({ where: { id: params.envId } })
  if (!env || env.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const parsed = CreateTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', message: parsed.error.message },
      { status: 400 },
    )
  }

  const { key, description, isRequired, defaultValue } = parsed.data

  // Key names must be unique within an environment
  const existing = await prisma.variableTemplate.findUnique({
    where: { environmentId_key: { environmentId: params.envId, key } },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'Conflict', message: `A template for "${key}" already exists in this environment.` },
      { status: 409 },
    )
  }

  const template = await prisma.variableTemplate.create({
    data: {
      environmentId: params.envId,
      key,
      description: description ?? null,
      isRequired,
      defaultValue: defaultValue ?? null,
    },
  })

  return NextResponse.json(template, { status: 201 })
}
