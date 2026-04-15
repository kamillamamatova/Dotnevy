import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { resolveUserRole } from '@/lib/membership'

// GET /api/repos/:repoId/audit
//
// Returns paginated, filterable audit log entries for a repository.
// Any authenticated member can read the audit log.
//
// Query parameters:
//   action   — filter by AuditAction enum value (e.g. PULL_VARS, SET_VAR)
//   envId    — filter by environment ID
//   page     — 1-indexed page number (default: 1)
//   limit    — entries per page (default: 25, max: 100)
//
// Response:
//   { entries, total, page, pages }

type Params = { params: { repoId: string } }

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') ?? undefined
  const envId = searchParams.get('envId') ?? undefined
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10)))

  const where = {
    repoId: params.repoId,
    ...(action && { action: action as never }),
    ...(envId && { environmentId: envId }),
  }

  const [rawEntries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { githubLogin: true, image: true } },
        environment: { select: { name: true, type: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ])

  const entries = rawEntries.map((e) => ({
    id: e.id,
    action: e.action,
    createdAt: e.createdAt.toISOString(),
    actor: {
      userId: e.userId,
      githubLogin: e.user.githubLogin,
      image: e.user.image,
    },
    environment: e.environment
      ? { id: e.environmentId, name: e.environment.name, type: e.environment.type }
      : null,
    detail: e.detail as Record<string, unknown> | null,
  }))

  return NextResponse.json({
    entries,
    total,
    page,
    pages: Math.ceil(total / limit),
  })
}
