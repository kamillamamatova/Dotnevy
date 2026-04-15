import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { SignJWT } from 'jose'
import { prisma } from '@pullenv/db'
import { permissionToRole } from '@/lib/github'

// In-memory state store for the device flow (replace with Redis in production)
const pendingStates = new Map<string, { userId: string; createdAt: number }>()

const CLI_JWT_SECRET = new TextEncoder().encode(
  process.env.CLI_JWT_SECRET ?? 'dev-secret-change-me',
)
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60  // 15 minutes

// GET /api/tokens/cli?state=<state>
// Called by the CLI to poll for a token after the user completes browser auth.
export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get('state')
  if (!state) return NextResponse.json({ error: 'Missing state' }, { status: 400 })

  const pending = pendingStates.get(state)

  if (!pending) {
    // State not yet claimed by a browser session
    return NextResponse.json({ status: 'pending' }, { status: 202 })
  }

  // Expire states older than 2 minutes
  if (Date.now() - pending.createdAt > 120_000) {
    pendingStates.delete(state)
    return NextResponse.json({ error: 'State expired' }, { status: 410 })
  }

  pendingStates.delete(state)

  const memberships = await prisma.repoMembership.findMany({
    where: { userId: pending.userId },
    select: { repoId: true, permission: true },
  })

  // Map GitHub permissions to 3-tier roles; exclude repos where the permission
  // doesn't map to a valid role (e.g. NONE, TRIAGE).
  const repoAccess = Object.fromEntries(
    memberships
      .map((m) => [m.repoId, permissionToRole(m.permission)] as const)
      .filter(([, role]) => role !== null),
  ) as Record<string, string>

  const user = await prisma.user.findUnique({ where: { id: pending.userId } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000)

  const accessToken = await new SignJWT({ githubLogin: user.githubLogin, repoAccess })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(CLI_JWT_SECRET)

  // TODO: persist refresh token in DB for revocation support
  const refreshToken = crypto.randomUUID()

  return NextResponse.json({ accessToken, refreshToken, expiresAt: expiresAt.toISOString() })
}

// POST /api/tokens/cli
// Called by the browser (logged-in session) to claim a pending state.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { state } = await req.json()
  if (!state || typeof state !== 'string') {
    return NextResponse.json({ error: 'Missing state' }, { status: 400 })
  }

  pendingStates.set(state, { userId: session.user.id, createdAt: Date.now() })
  return NextResponse.json({ ok: true })
}
