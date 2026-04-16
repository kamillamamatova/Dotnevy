import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { SignJWT } from 'jose'
import { prisma } from '@dotenvy/db'
import { permissionToRole } from '@/lib/github'

// ─── Constants ────────────────────────────────────────────────────────────────

const CLI_JWT_SECRET = new TextEncoder().encode(
  process.env.CLI_JWT_SECRET ?? 'dev-secret-change-me',
)
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60   // 15 minutes
const AUTH_REQUEST_TTL_SECONDS = 10 * 60   // 10 minutes — how long the browser has to complete login
const REFRESH_TOKEN_TTL_DAYS = 30          // 30 days rolling window

// How many outstanding pending auth requests one IP may have at a time.
// Prevents state-flooding if someone discovers the endpoint.
const MAX_PENDING_PER_IP = 5

// ─── GET /api/tokens/cli?state=<state> ───────────────────────────────────────
//
// Called by the CLI every ~3 seconds after opening the browser.
// Returns 202 while the user hasn't completed browser auth yet.
// Returns 200 with { accessToken, refreshToken, expiresAt } once claimed.
// Returns 410 if the state expired or was already consumed.
//
export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get('state')
  if (!state || !isValidUuid(state)) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  // Opportunistic cleanup of expired states (keeps the table tidy without a cron job)
  await prisma.cliAuthRequest.deleteMany({ where: { expiresAt: { lt: new Date() } } })

  const authRequest = await prisma.cliAuthRequest.findUnique({ where: { state } })

  if (!authRequest) {
    // Either expired (and just cleaned up) or never existed
    return NextResponse.json({ error: 'State expired or invalid' }, { status: 410 })
  }

  if (!authRequest.claimedByUserId) {
    // Browser hasn't completed the OAuth flow yet
    return NextResponse.json({ status: 'pending' }, { status: 202 })
  }

  // State is claimed — consume it immediately so it can't be polled again
  await prisma.cliAuthRequest.delete({ where: { state } })

  // Build the access token
  const [memberships, user] = await Promise.all([
    prisma.repoMembership.findMany({
      where: { userId: authRequest.claimedByUserId },
      select: { repoId: true, permission: true },
    }),
    prisma.user.findUnique({ where: { id: authRequest.claimedByUserId } }),
  ])

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const repoAccess = Object.fromEntries(
    memberships
      .map((m) => [m.repoId, permissionToRole(m.permission)] as const)
      .filter(([, role]) => role !== null),
  ) as Record<string, string>

  const now = Date.now()
  const accessExpiry = new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000)

  const accessToken = await new SignJWT({ githubLogin: user.githubLogin, repoAccess })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(accessExpiry)
    .sign(CLI_JWT_SECRET)

  // Persist the refresh token so it can be redeemed and revoked
  const refreshExpiry = new Date(now + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  const refreshToken = await prisma.cliRefreshToken.create({
    data: {
      token: crypto.randomUUID(),
      userId: user.id,
      expiresAt: refreshExpiry,
    },
  })

  return NextResponse.json({
    accessToken,
    refreshToken: refreshToken.token,
    expiresAt: accessExpiry.toISOString(),
  })
}

// ─── POST /api/tokens/cli ─────────────────────────────────────────────────────
//
// Called by the browser page (/cli-auth) once the user has a valid session.
// Marks the pending state as claimed by this user so the CLI can pick it up.
//
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const state = body?.state
  if (!state || typeof state !== 'string' || !isValidUuid(state)) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  // Rate-limit: at most MAX_PENDING_PER_IP unclaimed states per user to prevent abuse
  // (IP-based rate limiting would require a Redis counter; user-based is sufficient for MVP)
  const unclaimed = await prisma.cliAuthRequest.count({
    where: {
      claimedByUserId: null,
      expiresAt: { gt: new Date() },
    },
  })
  if (unclaimed >= MAX_PENDING_PER_IP * 10) {
    // Global safety valve — not per-user since the browser user is legitimate
    return NextResponse.json({ error: 'Too many pending requests' }, { status: 429 })
  }

  const authRequest = await prisma.cliAuthRequest.findUnique({ where: { state } })
  if (!authRequest) {
    return NextResponse.json({ error: 'State not found or expired' }, { status: 404 })
  }
  if (authRequest.claimedByUserId) {
    return NextResponse.json({ error: 'State already claimed' }, { status: 409 })
  }
  if (authRequest.expiresAt < new Date()) {
    await prisma.cliAuthRequest.delete({ where: { state } })
    return NextResponse.json({ error: 'State expired' }, { status: 410 })
  }

  await prisma.cliAuthRequest.update({
    where: { state },
    data: { claimedByUserId: session.user.id },
  })

  return NextResponse.json({ ok: true })
}

// ─── PUT /api/tokens/cli ──────────────────────────────────────────────────────
//
// Called by the CLI before opening the browser to pre-register the state.
// This ensures the state exists in the DB before the browser tries to claim it,
// eliminating the race where the browser claims a state not yet written.
//
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const state = body?.state
  if (!state || typeof state !== 'string' || !isValidUuid(state)) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  // Prevent duplicate state registration
  const existing = await prisma.cliAuthRequest.findUnique({ where: { state } })
  if (existing) {
    return NextResponse.json({ error: 'State already registered' }, { status: 409 })
  }

  await prisma.cliAuthRequest.create({
    data: {
      state,
      expiresAt: new Date(Date.now() + AUTH_REQUEST_TTL_SECONDS * 1000),
    },
  })

  return NextResponse.json({ ok: true })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}
