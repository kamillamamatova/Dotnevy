/**
 * Seed strategy for Pullenv
 *
 * Seed philosophy:
 *   - Seed only what is necessary to make the app functional and locally testable.
 *   - No fake users, repos, or secrets — those are created through real GitHub OAuth
 *     and the registration flow.
 *   - The seed file's job is structural: establish well-known reference data and
 *     a single developer test account that mirrors what a real user session produces.
 *
 * What to seed:
 *   1. A local dev user (bypasses GitHub OAuth when NODE_ENV=development)
 *   2. A fake GitHubInstallation for the dev user
 *   3. One test repo attached to that installation
 *   4. One "development" Environment with a few VariableTemplates (no SecretValues —
 *      those should be set via the dashboard or CLI, not seeded)
 *
 * What NOT to seed:
 *   - Real or realistic secrets (even fake values train bad habits)
 *   - Multiple users or orgs (makes the DB state hard to reason about)
 *   - Production-like data volumes
 */

import { PrismaClient, GitHubPermission, EnvironmentType } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Never run seed in production')
  }

  console.log('Seeding development data...')

  // 1. Local dev user
  const user = await prisma.user.upsert({
    where: { email: 'dev@localhost' },
    update: {},
    create: {
      githubId: 999999999,
      githubLogin: 'dev-user',
      name: 'Local Dev',
      email: 'dev@localhost',
    },
  })

  // 2. Fake GitHub App installation
  const installation = await prisma.gitHubInstallation.upsert({
    where: { installationId: 1 },
    update: {},
    create: {
      installationId: 1,
      accountLogin: 'dev-org',
      accountType: 'Organization',
      targetId: 1,
    },
  })

  // 3. Test repo
  const repo = await prisma.repo.upsert({
    where: { githubRepoId: 1 },
    update: {},
    create: {
      githubRepoId: 1,
      owner: 'dev-org',
      name: 'test-repo',
      private: true,
      installationId: installation.id,
    },
  })

  // 4. RepoMembership for the dev user
  await prisma.repoMembership.upsert({
    where: { userId_repoId: { userId: user.id, repoId: repo.id } },
    update: {},
    create: {
      userId: user.id,
      repoId: repo.id,
      permission: GitHubPermission.ADMIN,
    },
  })

  // 5. Development environment
  const env = await prisma.environment.upsert({
    where: { repoId_name: { repoId: repo.id, name: 'development' } },
    update: {},
    create: {
      repoId: repo.id,
      name: 'development',
      type: EnvironmentType.DEVELOPMENT,
      minPermission: GitHubPermission.READ,
      description: 'Local development environment',
    },
  })

  // 6. VariableTemplates — keys only, no secret values
  const templates = [
    { key: 'DATABASE_URL', description: 'PostgreSQL connection string', isRequired: true },
    { key: 'NEXTAUTH_SECRET', description: 'next-auth session secret', isRequired: true },
    { key: 'PORT', description: 'HTTP port', isRequired: false, defaultValue: '3000' },
  ]

  for (const t of templates) {
    await prisma.variableTemplate.upsert({
      where: { environmentId_key: { environmentId: env.id, key: t.key } },
      update: {},
      create: { environmentId: env.id, ...t },
    })
  }

  console.log(`Seeded: user=${user.githubLogin}, repo=${repo.owner}/${repo.name}`)
  console.log('Set actual secret values via the dashboard or: pullenv pull')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
