import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@dotenvy/db'
import { permissionToRole } from '@/lib/github'
import Link from 'next/link'
import type { RepoRole } from '@dotenvy/shared'

// ─── Type helpers ─────────────────────────────────────────────────────────────

const ENV_TYPE_DOT: Record<string, string> = {
  DEVELOPMENT: 'bg-green-400',
  STAGING: 'bg-yellow-400',
  PRODUCTION: 'bg-red-400',
  CUSTOM: 'bg-gray-300',
}

const ROLE_STYLES: Record<RepoRole, { badge: string; label: string }> = {
  READ: { badge: 'bg-gray-100 text-gray-500', label: 'read' },
  WRITE: { badge: 'bg-blue-50 text-blue-600', label: 'write' },
  ADMIN: { badge: 'bg-purple-50 text-purple-600', label: 'admin' },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) return null

  const memberships = await prisma.repoMembership.findMany({
    where: { userId: session.user.id },
    include: {
      repo: {
        include: {
          environments: {
            include: { _count: { select: { variableTemplates: true } } },
            orderBy: { createdAt: 'asc' },
          },
          memberships: { select: { id: true } },
        },
      },
    },
    orderBy: { repo: { updatedAt: 'desc' } },
  })

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* Page header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Welcome back, @{session.user.githubLogin}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {memberships.length === 0
              ? 'No repos connected yet.'
              : `You have access to ${memberships.length} repo${memberships.length === 1 ? '' : 's'}.`}
          </p>
        </div>
        <Link
          href="/repos/connect"
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50"
        >
          Connect repo
        </Link>
      </div>

      {memberships.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {memberships.map((m: (typeof memberships)[number]) => {
            const role = permissionToRole(m.permission)
            return (
              <RepoCard
                key={m.repo.id}
                repoId={m.repo.id}
                owner={m.repo.owner}
                name={m.repo.name}
                isPrivate={m.repo.private}
                role={role}
                environments={m.repo.environments.map((e: (typeof m.repo.environments)[number]) => ({
                  id: e.id,
                  name: e.name,
                  type: e.type,
                  varCount: e._count.variableTemplates,
                }))}
                memberCount={m.repo.memberships.length}
              />
            )
          })}
        </div>
      )}
    </main>
  )
}

// ─── Repo card ────────────────────────────────────────────────────────────────

interface RepoCardProps {
  repoId: string
  owner: string
  name: string
  isPrivate: boolean
  role: RepoRole | null
  environments: Array<{ id: string; name: string; type: string; varCount: number }>
  memberCount: number
}

function RepoCard({ repoId, owner, name, isPrivate, role, environments, memberCount }: RepoCardProps) {
  const roleStyle = role ? ROLE_STYLES[role] : null
  const totalVars = environments.reduce((sum, e) => sum + e.varCount, 0)

  return (
    <div className="rounded-lg border border-gray-200 bg-white transition-shadow hover:shadow-sm">
      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={`/repos/${repoId}`}
            className="font-mono text-sm font-semibold text-gray-900 hover:text-blue-600 truncate"
          >
            {owner}/{name}
          </Link>
          {isPrivate && (
            <span className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
              Private
            </span>
          )}
          {roleStyle && (
            <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${roleStyle.badge}`}>
              {roleStyle.label}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <span className="hidden text-xs text-gray-400 sm:block">
            {memberCount} member{memberCount !== 1 ? 's' : ''}
            {totalVars > 0 ? ` · ${totalVars} var${totalVars !== 1 ? 's' : ''}` : ''}
          </span>
          <Link
            href={`/repos/${repoId}/setup`}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
          >
            Get set up
          </Link>
          <Link
            href={`/repos/${repoId}`}
            className="text-xs text-gray-400 hover:text-gray-700"
          >
            Manage →
          </Link>
        </div>
      </div>

      {/* Environment chips */}
      {environments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-5 py-3">
          {environments.map((env) => (
            <Link
              key={env.id}
              href={`/repos/${repoId}/environments/${env.id}`}
              className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600 hover:border-gray-300 hover:bg-white transition-colors"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${ENV_TYPE_DOT[env.type] ?? ENV_TYPE_DOT.CUSTOM}`} />
              <span className="font-mono">{env.name}</span>
              {env.varCount > 0 && <span className="text-gray-400">{env.varCount}</span>}
            </Link>
          ))}
          <Link
            href={`/repos/${repoId}/environments/new`}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            + env
          </Link>
        </div>
      ) : (
        <div className="border-t border-gray-100 px-5 py-3">
          <Link
            href={`/repos/${repoId}/environments/new`}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            + Set up first environment
          </Link>
        </div>
      )}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
        <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-700">No repos connected yet</p>
      <p className="mt-1.5 mx-auto max-w-sm text-xs text-gray-400">
        Connect a GitHub repo to start managing its environment variables across your team.
      </p>
      <Link
        href="/repos/connect"
        className="mt-5 inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
      >
        Connect your first repo
      </Link>
    </div>
  )
}
