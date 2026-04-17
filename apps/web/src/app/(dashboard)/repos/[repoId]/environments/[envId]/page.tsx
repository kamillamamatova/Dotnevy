import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@dotenvy/db'
import { notFound, redirect } from 'next/navigation'
import { resolveUserRole } from '@/lib/membership'
import { permissionToRole } from '@/lib/github'
import { canWrite, canPull } from '@dotenvy/shared'
import Link from 'next/link'
import { VariablePanel } from '@/components/variable-panel'
import { DeleteEnvButton } from '@/components/delete-env-button'
import { CliCommand } from '@/components/cli-command'

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
    include: {
      variableTemplates: {
        orderBy: { key: 'asc' },
        include: {
          secretValues: {
            orderBy: { version: 'desc' },
            take: 1,
            select: {
              version: true,
              createdAt: true,
              createdBy: { select: { githubLogin: true } },
              // encryptedVal and iv intentionally NOT selected
            },
          },
        },
      },
    },
  })
  if (!env || env.repoId !== params.repoId) notFound()

  const minRole = permissionToRole(env.minPermission) ?? 'READ'
  const userCanManage = canWrite(role)
  const userCanReveal = canPull(role, minRole)
  const typeInfo = ENV_TYPE_LABELS[env.type] ?? ENV_TYPE_LABELS.CUSTOM

  const variables = env.variableTemplates.map((t) => {
    const latest = t.secretValues[0] ?? null
    return {
      templateId: t.id,
      key: t.key,
      description: t.description,
      isRequired: t.isRequired,
      defaultValue: t.defaultValue,
      hasSecret: latest !== null,
      currentVersion: latest?.version ?? null,
      updatedAt: latest?.createdAt.toISOString() ?? null,
      updatedBy: latest?.createdBy.githubLogin ?? null,
    }
  })

  // Required variables with no value set and no non-secret default
  const missingRequired = variables.filter(
    (v) => v.isRequired && !v.hasSecret && v.defaultValue === null,
  )

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

      {/* Pull command */}
      {userCanReveal && (
        <div className="mb-8 rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Pull this environment
          </p>
          <CliCommand
            command={`dotenvy pull --repo ${repo.owner}/${repo.name} --env ${env.name}`}
          />
          <p className="mt-2 text-xs text-gray-400">
            First time?{' '}
            <Link
              href={`/repos/${params.repoId}/setup`}
              className="underline underline-offset-2 hover:text-gray-600"
            >
              See the full setup guide
            </Link>
            .
          </p>
        </div>
      )}

      {/* Missing required variables warning */}
      {missingRequired.length > 0 && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">
            {missingRequired.length} required variable{missingRequired.length !== 1 ? 's' : ''}{' '}
            {missingRequired.length !== 1 ? 'have' : 'has'} no value set
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missingRequired.map((v) => (
              <code
                key={v.templateId}
                className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs text-amber-900"
              >
                {v.key}
              </code>
            ))}
          </div>
          <p className="mt-2 text-xs text-amber-700">
            These variables are marked required but have no secret value. Pulling this environment
            will succeed but these keys will be absent from the output.
          </p>
        </div>
      )}

      {/* Variables */}
      <section>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Variables</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Define the variables this environment expects and manage their encrypted secret values.
            Raw values are never shown by default — use <strong>Reveal</strong> to view a value and
            generate an audit log entry.
          </p>
        </div>

        <VariablePanel
          repoId={params.repoId}
          envId={params.envId}
          initialVariables={variables}
          canManage={userCanManage}
          canReveal={userCanReveal}
        />
      </section>
    </main>
  )
}
