import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from '@dotenvy/db'
import { syncRepoMemberships } from '@/lib/membership'

// ─── Webhook architecture notes ───────────────────────────────────────────────
//
// All GitHub App webhooks arrive here. Events fall into two categories:
//
// 1. INSTALLATION EVENTS  (installation, installation_repositories)
//    Drive the GitHubInstallation and Repo tables. These are the primary source
//    of truth for which repos are accessible via the GitHub App.
//
// 2. MEMBER EVENTS  (member)
//    Invalidate cached RepoMembership rows so the next access triggers a
//    fresh permission sync from the GitHub API.
//
// All events are authenticated with HMAC-SHA256 using GITHUB_APP_WEBHOOK_SECRET.
// ─────────────────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET ?? ''

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  if (!verifySignature(req, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = req.headers.get('x-github-event')
  const payload = JSON.parse(rawBody)

  switch (event) {
    case 'installation':
      await handleInstallationEvent(payload)
      break
    case 'installation_repositories':
      await handleInstallationRepositoriesEvent(payload)
      break
    case 'member':
      await handleMemberEvent(payload)
      break
    default:
      break
  }

  return NextResponse.json({ ok: true })
}

// ─── Installation events ──────────────────────────────────────────────────────

type InstallationPayload = {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend' | 'new_permissions_accepted'
  installation: {
    id: number
    account: { login: string; type: string; id: number }
    suspended_at: string | null
  }
  repositories?: Array<{ id: number; name: string; full_name: string; private: boolean }>
}

async function handleInstallationEvent(payload: InstallationPayload) {
  const { action, installation, repositories } = payload

  if (action === 'deleted') {
    // Mark all repos under this installation as no longer App-managed by
    // migrating them to a suspended state. For MVP we simply mark the
    // installation as suspended; a future cleanup job can archive repos.
    await prisma.gitHubInstallation.updateMany({
      where: { installationId: installation.id },
      data: { suspended: true, updatedAt: new Date() },
    })
    return
  }

  if (action === 'suspend') {
    await prisma.gitHubInstallation.updateMany({
      where: { installationId: installation.id },
      data: { suspended: true, updatedAt: new Date() },
    })
    return
  }

  if (action === 'unsuspend') {
    await prisma.gitHubInstallation.updateMany({
      where: { installationId: installation.id },
      data: { suspended: false, updatedAt: new Date() },
    })
    return
  }

  // action: 'created' or 'new_permissions_accepted'
  const dbInstallation = await prisma.gitHubInstallation.upsert({
    where: { installationId: installation.id },
    create: {
      installationId: installation.id,
      accountLogin: installation.account.login,
      accountType: installation.account.type,
      targetId: installation.account.id,
      suspended: installation.suspended_at !== null,
    },
    update: {
      accountLogin: installation.account.login,
      suspended: installation.suspended_at !== null,
      updatedAt: new Date(),
    },
  })

  // Register repos included in the installation event (present on 'created')
  if (repositories?.length) {
    await upsertRepos(dbInstallation.id, repositories)
  }
}

type InstallationRepositoriesPayload = {
  action: 'added' | 'removed'
  installation: { id: number }
  repositories_added: Array<{ id: number; name: string; full_name: string; private: boolean }>
  repositories_removed: Array<{ id: number }>
}

async function handleInstallationRepositoriesEvent(payload: InstallationRepositoriesPayload) {
  const installation = await prisma.gitHubInstallation.findUnique({
    where: { installationId: payload.installation.id },
  })
  if (!installation) return

  if (payload.action === 'added' && payload.repositories_added.length) {
    await upsertRepos(installation.id, payload.repositories_added)
  }

  if (payload.action === 'removed' && payload.repositories_removed.length) {
    // Repos removed from the installation lose App access but we keep them in
    // the DB so teams don't lose their variable config. A suspended flag or
    // explicit deletion can be added in a future phase.
    const removedIds = payload.repositories_removed.map((r) => r.id)
    const repos = await prisma.repo.findMany({
      where: { githubRepoId: { in: removedIds } },
    })
    // Force all memberships to re-sync on next access so stale permissions aren't served
    await Promise.allSettled(repos.map((r) => syncRepoMemberships(r.id)))
  }
}

async function upsertRepos(
  installationDbId: string,
  repos: Array<{ id: number; name: string; full_name: string; private: boolean }>,
) {
  for (const r of repos) {
    const [owner, name] = r.full_name.split('/')
    const repo = await prisma.repo.upsert({
      where: { githubRepoId: r.id },
      create: {
        githubRepoId: r.id,
        owner,
        name,
        private: r.private,
        installationId: installationDbId,
      },
      update: {
        // Migrate to real installation if this repo was previously manually connected
        installationId: installationDbId,
        updatedAt: new Date(),
      },
    })

    // Force a permission re-sync for all existing members of this repo
    await syncRepoMemberships(repo.id)
  }
}

// ─── Member events ────────────────────────────────────────────────────────────

type MemberPayload = {
  action: 'added' | 'removed' | 'edited'
  member: { id: number }
  repository: { id: number }
}

async function handleMemberEvent(payload: MemberPayload) {
  if (!['added', 'removed', 'edited'].includes(payload.action)) return

  const user = await prisma.user.findFirst({ where: { githubId: payload.member.id } })
  const repo = await prisma.repo.findFirst({ where: { githubRepoId: payload.repository.id } })

  if (!user || !repo) return

  if (payload.action === 'removed') {
    await prisma.repoMembership.deleteMany({
      where: { userId: user.id, repoId: repo.id },
    })
  } else {
    // 'added' or 'edited' — reset syncedAt to epoch to force re-sync on next access
    await prisma.repoMembership.updateMany({
      where: { userId: user.id, repoId: repo.id },
      data: { syncedAt: new Date(0) },
    })
  }
}

// ─── Signature verification ───────────────────────────────────────────────────

function verifySignature(req: NextRequest, body: string): boolean {
  const signature = req.headers.get('x-hub-signature-256')
  if (!signature || !WEBHOOK_SECRET) return false

  const expected = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`
  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)

  if (sigBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(sigBuffer, expectedBuffer)
}
