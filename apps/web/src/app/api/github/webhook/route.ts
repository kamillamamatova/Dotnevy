import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from '@pullenv/db'

const WEBHOOK_SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET ?? ''

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  if (!verifySignature(req, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = req.headers.get('x-github-event')
  const payload = JSON.parse(rawBody)

  switch (event) {
    case 'member':
      await handleMemberEvent(payload)
      break
    case 'installation':
    case 'installation_repositories':
      // TODO: handle app installation/uninstallation
      break
    default:
      // Ignore unhandled events
      break
  }

  return NextResponse.json({ ok: true })
}

async function handleMemberEvent(payload: {
  action: string
  member: { id: number }
  repository: { id: number }
}) {
  // Invalidate cached membership when a user's role changes or they are removed
  if (['added', 'removed', 'edited'].includes(payload.action)) {
    const user = await prisma.user.findFirst({ where: { githubId: payload.member.id } })
    const repo = await prisma.repo.findFirst({ where: { githubRepoId: payload.repository.id } })

    if (!user || !repo) return

    if (payload.action === 'removed') {
      await prisma.repoMembership.deleteMany({
        where: { userId: user.id, repoId: repo.id },
      })
    } else {
      // Force re-sync on next access by resetting syncedAt to epoch
      await prisma.repoMembership.updateMany({
        where: { userId: user.id, repoId: repo.id },
        data: { syncedAt: new Date(0) },
      })
    }
  }
}

function verifySignature(req: NextRequest, body: string): boolean {
  const signature = req.headers.get('x-hub-signature-256')
  if (!signature || !WEBHOOK_SECRET) return false

  const expected = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`
  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)

  if (sigBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(sigBuffer, expectedBuffer)
}
