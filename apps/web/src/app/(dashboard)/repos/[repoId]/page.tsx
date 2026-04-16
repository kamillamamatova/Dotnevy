import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@dotenvy/db'
import { notFound, redirect } from 'next/navigation'
import { resolveUserRole } from '@/lib/membership'
import { permissionToRole } from '@/lib/github'
import { canWrite, canPull } from '@dotenvy/shared'
import {
  RepoDetailTabs,
  type Member,
  type ActivityEntry,
  type EnvironmentSummary,
} from '@/components/repo-detail-tabs'
import Link from 'next/link'

type Props = { params: { repoId: string } }

export default async function RepoDetailPage({ params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) notFound()

  const repo = await prisma.repo.findUnique({ where: { id: params.repoId } })
  if (!repo) notFound()

  // Environments for the Environments tab
  const rawEnvs = await prisma.environment.findMany({
    where: { repoId: params.repoId },
    include: { _count: { select: { variableTemplates: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const environments: EnvironmentSummary[] = rawEnvs.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    minRole: permissionToRole(e.minPermission) ?? 'READ',
    description: e.description,
    templateCount: e._count.variableTemplates,
  }))

  // Whether the user can pull at least one environment
  const hasPullableEnv = environments.some((e) => canPull(role, e.minRole))

  // Members for the Access tab
  const rawMembers = await prisma.repoMembership.findMany({
    where: { repoId: params.repoId },
    include: { user: { select: { githubLogin: true, image: true } } },
  })

  const members: Member[] = rawMembers.map((m) => ({
    userId: m.userId,
    permission: m.permission,
    role: permissionToRole(m.permission),
    githubLogin: m.user.githubLogin,
    image: m.user.image,
  }))

  // Recent activity for the Activity tab (last 10 — full history is at /activity)
  const rawActivity = await prisma.auditLog.findMany({
    where: { repoId: params.repoId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      user: { select: { githubLogin: true, image: true } },
      environment: { select: { name: true, type: true } },
    },
  })

  const activity: ActivityEntry[] = rawActivity.map((a) => ({
    id: a.id,
    action: a.action,
    createdAt: a.createdAt.toISOString(),
    actor: {
      userId: a.userId,
      githubLogin: a.user.githubLogin,
      image: a.user.image,
    },
    environment: a.environment
      ? { id: a.environmentId, name: a.environment.name, type: a.environment.type }
      : null,
    detail: a.detail as Record<string, unknown> | null,
  }))

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-800">
          ← All repos
        </Link>

        <div className="mt-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-2xl font-semibold text-gray-900">
                {repo.owner}/{repo.name}
              </h1>
              {repo.private && (
                <span className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Private
                </span>
              )}
              <RoleBadge role={role} />
            </div>
            <a
              href={`https://github.com/${repo.owner}/${repo.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
            >
              github.com/{repo.owner}/{repo.name}
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          </div>
        </div>
      </div>

      {/* Setup callout */}
      {hasPullableEnv && (
        <div className="mb-6 flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-blue-900">New to this repo?</p>
            <p className="mt-0.5 text-xs text-blue-700">
              Get the CLI set up and pull your local environment variables in minutes.
            </p>
          </div>
          <Link
            href={`/repos/${params.repoId}/setup`}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Get set up →
          </Link>
        </div>
      )}

      <RepoDetailTabs
        repoId={params.repoId}
        environments={environments}
        members={members}
        activity={activity}
        canManage={canWrite(role)}
      />
    </main>
  )
}

function RoleBadge({ role }: { role: 'READ' | 'WRITE' | 'ADMIN' }) {
  const styles = {
    READ: 'bg-gray-100 text-gray-600',
    WRITE: 'bg-blue-50 text-blue-700',
    ADMIN: 'bg-purple-50 text-purple-700',
  }
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[role]}`}>{role}</span>
  )
}
