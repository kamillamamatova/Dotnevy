import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { notFound, redirect } from 'next/navigation'
import { resolveUserRole } from '@/lib/membership'
import { permissionToRole } from '@/lib/github'
import { canWrite } from '@pullenv/shared'
import Link from 'next/link'
import { TemplateManager } from '@/components/template-manager'
import { DeleteEnvButton } from '@/components/delete-env-button'

type Props = { params: { repoId: string; envId: string } }

const ENV_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  DEVELOPMENT: { label: 'Development', color: 'bg-green-100 text-green-800' },
  STAGING: { label: 'Staging', color: 'bg-yellow-100 text-yellow-800' },
  PRODUCTION: { label: 'Production', color: 'bg-red-100 text-red-800' },
  CUSTOM: { label: 'Custom', color: 'bg-gray-100 text-gray-700' },
}

const MIN_ROLE_LABELS: Record<string, string> = {
  READ: 'Any member',
  WRITE: 'Contributors+',
  ADMIN: 'Admins only',
}

export default async function EnvironmentPage({ params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) notFound()

  const repo = await prisma.repo.findUnique({ where: { id: params.repoId } })
  if (!repo) notFound()

  const env = await prisma.environment.findUnique({
    where: { id: params.envId },
    include: { variableTemplates: { orderBy: { key: 'asc' } } },
  })
  if (!env || env.repoId !== params.repoId) notFound()

  const minRole = permissionToRole(env.minPermission) ?? 'READ'
  const userCanManage = canWrite(role)
  const typeInfo = ENV_TYPE_LABELS[env.type] ?? ENV_TYPE_LABELS.CUSTOM

  const templates = env.variableTemplates.map((t) => ({
    id: t.id,
    key: t.key,
    description: t.description,
    isRequired: t.isRequired,
    defaultValue: t.defaultValue,
    createdAt: t.createdAt.toISOString(),
  }))

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/dashboard" className="hover:text-gray-800">Repos</Link>
        <span>/</span>
        <Link href={`/repos/${params.repoId}`} className="hover:text-gray-800">
          {repo.owner}/{repo.name}
        </Link>
        <span>/</span>
        <span className="text-gray-900">{env.name}</span>
      </nav>

      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">{env.name}</h1>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${typeInfo.color}`}>
              {typeInfo.label}
            </span>
          </div>
          {env.description && (
            <p className="mt-1 text-sm text-gray-500">{env.description}</p>
          )}
          <p className="mt-2 text-xs text-gray-400">
            Minimum access to pull secrets:{' '}
            <span className="font-medium text-gray-600">{MIN_ROLE_LABELS[minRole]}</span>
          </p>
        </div>

        {userCanManage && (
          <DeleteEnvButton
            repoId={params.repoId}
            envId={params.envId}
            envName={env.name}
          />
        )}
      </div>

      {/* Variable templates */}
      <section>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Variable Templates</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Define which variables this environment expects. Think of this as a typed{' '}
            <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">.env.example</code>.
            Secret values are managed separately.
          </p>
        </div>

        <TemplateManager
          repoId={params.repoId}
          envId={params.envId}
          initialTemplates={templates}
          canManage={userCanManage}
        />
      </section>
    </main>
  )
}
