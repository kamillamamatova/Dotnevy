import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { permissionToRole } from '@/lib/github'
import Link from 'next/link'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) return null

  const memberships = await prisma.repoMembership.findMany({
    where: { userId: session.user.id },
    include: { repo: true },
    orderBy: { repo: { updatedAt: 'desc' } },
  })

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Repos</h1>
          <p className="mt-1 text-sm text-gray-500">Repositories connected to Pullenv</p>
        </div>
        <Link
          href="/repos/connect"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Connect repo
        </Link>
      </div>

      {memberships.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm font-medium text-gray-700">No repos connected yet</p>
          <p className="mt-1 text-xs text-gray-400">
            Connect a repo to start managing its environment variables.
          </p>
          <Link
            href="/repos/connect"
            className="mt-4 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Connect your first repo
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {memberships.map(({ repo, permission }) => {
            const role = permissionToRole(permission)
            return (
              <li key={repo.id}>
                <Link
                  href={`/repos/${repo.id}`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    {repo.private && (
                      <span className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                        Private
                      </span>
                    )}
                    <span className="font-mono text-sm font-medium text-gray-900">
                      {repo.owner}/{repo.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {role && <RoleBadge role={role} />}
                    <svg
                      className="h-4 w-4 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
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
