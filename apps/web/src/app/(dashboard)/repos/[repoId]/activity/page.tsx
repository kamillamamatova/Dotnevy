import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@dotenvy/db'
import { notFound, redirect } from 'next/navigation'
import { resolveUserRole } from '@/lib/membership'
import Link from 'next/link'
import { ActivityView, type AuditEntry } from '@/components/audit-log-list'

type Props = {
  params: { repoId: string }
  searchParams: { action?: string; envId?: string; page?: string }
}

const PAGE_SIZE = 25

export default async function ActivityPage({ params, searchParams }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) notFound()

  const repo = await prisma.repo.findUnique({ where: { id: params.repoId } })
  if (!repo) notFound()

  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10))
  const action = searchParams.action ?? undefined
  const envId = searchParams.envId ?? undefined

  const where = {
    repoId: params.repoId,
    ...(action && { action: action as never }),
    ...(envId && { environmentId: envId }),
  }

  const [rawEntries, total, environments] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { githubLogin: true, image: true } },
        environment: { select: { name: true, type: true } },
      },
    }),
    prisma.auditLog.count({ where }),
    prisma.environment.findMany({
      where: { repoId: params.repoId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    }),
  ])

  const entries: AuditEntry[] = rawEntries.map((e) => ({
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

  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/dashboard" className="hover:text-gray-800">
          Repos
        </Link>
        <span>/</span>
        <Link href={`/repos/${params.repoId}`} className="hover:text-gray-800">
          {repo.owner}/{repo.name}
        </Link>
        <span>/</span>
        <span className="text-gray-900">Activity</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Audit trail</h1>
        <p className="mt-1 text-sm text-gray-500">
          A complete record of who did what and when. Secret values are never included.
        </p>
      </div>

      {/* Activity view — filters + list + pagination (client component) */}
      <ActivityView
        repoId={params.repoId}
        initialEntries={entries}
        initialTotal={total}
        initialPages={pages}
        environments={environments}
      />
    </main>
  )
}
