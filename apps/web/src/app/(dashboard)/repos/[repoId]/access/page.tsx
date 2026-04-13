import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { notFound, redirect } from 'next/navigation'
import { resolveUserRole } from '@/lib/membership'
import { permissionToRole } from '@/lib/github'
import { canAdmin } from '@pullenv/shared'
import Link from 'next/link'
import {
  AccessPanel,
  type AccessMember,
  type AccessEnvironment,
  type PolicyOverride,
} from '@/components/access-panel'

type Props = { params: { repoId: string } }

export default async function AccessPage({ params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) notFound()

  const repo = await prisma.repo.findUnique({ where: { id: params.repoId } })
  if (!repo) notFound()

  const [rawMembers, rawEnvs, rawPolicies] = await Promise.all([
    prisma.repoMembership.findMany({
      where: { repoId: params.repoId },
      include: { user: { select: { githubLogin: true, image: true, name: true } } },
      orderBy: { syncedAt: 'desc' },
    }),
    prisma.environment.findMany({
      where: { repoId: params.repoId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.accessPolicy.findMany({
      where: { repoId: params.repoId },
      include: { user: { select: { githubLogin: true, image: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const members: AccessMember[] = rawMembers.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    githubLogin: m.user.githubLogin,
    name: m.user.name,
    image: m.user.image,
    permission: m.permission,
    role: permissionToRole(m.permission),
    syncedAt: m.syncedAt.toISOString(),
  }))

  const environments: AccessEnvironment[] = rawEnvs.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    minRole: permissionToRole(e.minPermission) ?? 'READ',
    description: e.description,
  }))

  const policies: PolicyOverride[] = rawPolicies.map((p) => ({
    id: p.id,
    userId: p.userId,
    githubLogin: p.user.githubLogin,
    userImage: p.user.image,
    environmentId: p.environmentId,
    action: p.action as 'PULL' | 'WRITE',
    effect: p.effect as 'ALLOW' | 'DENY',
    createdAt: p.createdAt.toISOString(),
  }))

  const isAdmin = canAdmin(role)

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
        <span className="text-gray-900">Access</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Access management</h1>
        <p className="mt-1 text-sm text-gray-500">
          Control who can pull and write secrets for each environment.
          {isAdmin ? (
            ' As an admin, you can adjust environment minimums and add per-user overrides.'
          ) : (
            ' Contact an admin to change access policies.'
          )}
        </p>
      </div>

      {/* Members summary */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Members ({members.length})
        </h2>
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                {m.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.image} alt={m.githubLogin ?? ''} className="h-7 w-7 rounded-full" />
                )}
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {m.githubLogin ? `@${m.githubLogin}` : m.userId.slice(0, 8)}
                  </p>
                  {m.name && <p className="text-xs text-gray-400">{m.name}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{m.permission}</span>
                {m.role && (
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      m.role === 'ADMIN'
                        ? 'bg-purple-50 text-purple-700'
                        : m.role === 'WRITE'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {m.role}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Access panel — environment settings + overrides */}
      <section>
        <AccessPanel
          repoId={params.repoId}
          members={members}
          environments={environments}
          policies={policies}
          isAdmin={isAdmin}
        />
      </section>
    </main>
  )
}
