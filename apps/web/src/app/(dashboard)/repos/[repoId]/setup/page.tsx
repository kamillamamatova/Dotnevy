import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@dotenvy/db'
import { notFound, redirect } from 'next/navigation'
import { resolveUserRole } from '@/lib/membership'
import { permissionToRole } from '@/lib/github'
import { canPull } from '@dotenvy/shared'
import Link from 'next/link'
import { CliCommand } from '@/components/cli-command'

type Props = { params: { repoId: string } }

const ENV_TYPE_STYLES: Record<string, { label: string; dot: string }> = {
  DEVELOPMENT: { label: 'development', dot: 'bg-green-400' },
  STAGING: { label: 'staging', dot: 'bg-yellow-400' },
  PRODUCTION: { label: 'production', dot: 'bg-red-400' },
  CUSTOM: { label: 'custom', dot: 'bg-gray-400' },
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  READ: 'read access',
  WRITE: 'contributor access',
  ADMIN: 'admin access',
}

export default async function SetupPage({ params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) notFound()

  const repo = await prisma.repo.findUnique({ where: { id: params.repoId } })
  if (!repo) notFound()

  const rawEnvs = await prisma.environment.findMany({
    where: { repoId: params.repoId },
    include: { _count: { select: { variableTemplates: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const repoSlug = `${repo.owner}/${repo.name}`

  const envs = rawEnvs.map((e) => {
    const minRole = permissionToRole(e.minPermission) ?? 'READ'
    const accessible = canPull(role, minRole)
    return {
      id: e.id,
      name: e.name,
      type: e.type,
      minRole,
      accessible,
      templateCount: e._count.variableTemplates,
    }
  })

  const pullableEnvs = envs.filter((e) => e.accessible)
  // Prefer development, then first available
  const defaultEnv =
    pullableEnvs.find((e) => e.type === 'DEVELOPMENT') ??
    pullableEnvs.find((e) => e.type === 'CUSTOM') ??
    pullableEnvs[0]

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/dashboard" className="hover:text-gray-800">Repos</Link>
        <span>/</span>
        <Link href={`/repos/${params.repoId}`} className="hover:text-gray-800">{repoSlug}</Link>
        <span>/</span>
        <span className="text-gray-900">Get set up</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Get set up with {repoSlug}</h1>
        <p className="mt-2 text-sm text-gray-500">
          You have{' '}
          <span className="font-medium text-gray-700">{ROLE_DESCRIPTIONS[role]}</span>
          {' '}on this repo. Follow these steps to pull your local environment variables.
        </p>
      </div>

      {/* Access summary */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Your environment access</h2>
        <ul className="space-y-2">
          {envs.length === 0 ? (
            <li className="text-sm text-gray-400">No environments set up yet.</li>
          ) : (
            envs.map((env) => {
              const style = ENV_TYPE_STYLES[env.type] ?? ENV_TYPE_STYLES.CUSTOM
              return (
                <li key={env.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                    <span className="font-mono text-sm text-gray-900">{env.name}</span>
                    <span className="text-xs text-gray-400">
                      {env.templateCount} var{env.templateCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {env.accessible ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                      </svg>
                      Can pull
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-gray-400">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5.5 5V4a2.5 2.5 0 015 0v1h.5A1.5 1.5 0 0112.5 6.5v6A1.5 1.5 0 0111 14H5a1.5 1.5 0 01-1.5-1.5v-6A1.5 1.5 0 015 5h.5zm4.5 0V4a2 2 0 00-4 0v1h4z" />
                      </svg>
                      Requires {env.minRole.toLowerCase()} access
                    </span>
                  )}
                </li>
              )
            })
          )}
        </ul>
        {pullableEnvs.length === 0 && envs.length > 0 && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            You don&apos;t have access to any environment yet. Ask a repo admin to grant you access.
          </p>
        )}
      </section>

      {pullableEnvs.length > 0 ? (
        <>
          {/* Step 1: Install */}
          <SetupStep
            number={1}
            title="Install the Dotenvy CLI"
            description="One-time install. Requires Node.js ≥ 20."
          >
            <CliCommand command="npm install -g dotenvy" />
          </SetupStep>

          {/* Step 2: Login */}
          <SetupStep
            number={2}
            title="Authenticate with GitHub"
            description="Opens a browser window to complete GitHub OAuth. Your credentials are stored in ~/.dotenvy/credentials.json."
          >
            <CliCommand command="dotenvy login" />
          </SetupStep>

          {/* Step 3: Initialize */}
          <SetupStep
            number={3}
            title="Initialize this project"
            description={`Run this once inside your local clone of ${repoSlug}. It creates a .dotenvy.json that pins the repo and default environment — commit it so teammates don't need to re-run this step.`}
          >
            <CliCommand command={`dotenvy init`} />
          </SetupStep>

          {/* Step 4: Pull */}
          <SetupStep
            number={4}
            title="Pull your environment variables"
            description={`Writes a .env.local file (mode 0600, auto-added to .gitignore) with all the variables for this environment.`}
          >
            <div className="space-y-3">
              {pullableEnvs.map((env) => (
                <CliCommand
                  key={env.id}
                  label={`Pull ${env.name}`}
                  command={`dotenvy pull --repo ${repoSlug} --env ${env.name}`}
                />
              ))}
            </div>
          </SetupStep>

          {/* One-liner shortcut */}
          {defaultEnv && (
            <div className="mt-8 rounded-lg border border-blue-100 bg-blue-50 p-5">
              <p className="mb-2 text-sm font-semibold text-blue-900">Just need a quick setup?</p>
              <p className="mb-3 text-xs text-blue-700">
                After running <code className="rounded bg-blue-100 px-1">dotenvy login</code> once, this single command will pull your {defaultEnv.name} variables:
              </p>
              <CliCommand command={`dotenvy pull --repo ${repoSlug} --env ${defaultEnv.name}`} />
            </div>
          )}

          {/* Ongoing usage */}
          <div className="mt-8 border-t border-gray-100 pt-6">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">Keeping variables up to date</h3>
            <ul className="space-y-2.5 text-sm text-gray-600">
              <li className="flex gap-2.5">
                <span className="mt-0.5 shrink-0 font-mono text-xs text-gray-400">→</span>
                <span>
                  Run <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono">dotenvy pull --force</code> any time to re-pull and merge the latest values into your local file.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="mt-0.5 shrink-0 font-mono text-xs text-gray-400">→</span>
                <span>
                  Run <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono">dotenvy pull --check</code> in CI to verify your local file is up to date.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="mt-0.5 shrink-0 font-mono text-xs text-gray-400">→</span>
                <span>
                  Every pull is logged. Admins can see who pulled what on the{' '}
                  <Link href={`/repos/${params.repoId}/activity`} className="underline underline-offset-2 hover:text-gray-900">
                    activity page
                  </Link>
                  .
                </span>
              </li>
            </ul>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm font-medium text-gray-700">No environments to pull yet</p>
          <p className="mt-1 text-xs text-gray-400">
            {envs.length === 0
              ? 'This repo has no environments set up. Ask an admin to add one.'
              : "You don't have pull access to any environment. Ask a repo admin."}
          </p>
        </div>
      )}
    </main>
  )
}

// ─── Step component ───────────────────────────────────────────────────────────

function SetupStep({
  number,
  title,
  description,
  children,
}: {
  number: number
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-8 flex gap-5">
      {/* Step number */}
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
          {number}
        </div>
        <div className="w-px flex-1 bg-gray-200" />
      </div>

      {/* Content */}
      <div className="pb-8 min-w-0 w-full">
        <h2 className="mb-1 text-base font-semibold text-gray-900">{title}</h2>
        <p className="mb-4 text-sm text-gray-500">{description}</p>
        {children}
      </div>
    </div>
  )
}
