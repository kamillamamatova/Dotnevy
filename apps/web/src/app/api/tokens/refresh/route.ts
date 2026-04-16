import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { prisma } from '@dotenvy/db'
import { permissionToRole } from '@/lib/github'

// ─── POST /api/tokens/refresh ─────────────────────────────────────────────────
//
// Exchanges a valid refresh token for a new short-lived JWT.
// The old refresh token is rotated (invalidated and replaced) on each use
// to limit the blast radius if a refresh token is ever leaked.
//
// Body: { refreshToken: string }
// Response: { accessToken, refreshToken, expiresAt }
//
// Error cases:
//   400 — missing or malformed body
//   401 — token not found, revoked, or expired
//
// ─────────────────────────────────────────────────────────────────────────────

const CLI_JWT_SECRET = new TextEncoder().encode(
  process.env.CLI_JWT_SECRET ?? 'dev-secret-change-me',
)
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60  // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 30         // rolling 30-day window

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const incomingToken = body?.refreshToken
  if (!incomingToken || typeof incomingToken !== 'string') {
    return NextResponse.json({ error: 'Missing refreshToken' }, { status: 400 })
  }

  // Look up the token — must exist, not be revoked, and not be expired
  const record = await prisma.cliRefreshToken.findUnique({
    where: { token: incomingToken },
    include: { user: true },
  })

  if (!record) {
    return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 })
  }
  if (record.revokedAt) {
    return NextResponse.json({ error: 'Refresh token has been revoked' }, { status: 401 })
  }
  if (record.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Refresh token expired' }, { status: 401 })
  }

  const { user } = record

  // Re-read current repo memberships so the new token reflects any access changes
  const memberships = await prisma.repoMembership.findMany({
    where: { userId: user.id },
    select: { repoId: true, permission: true },
  })

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

  // Token rotation: revoke the old token and issue a new one atomically.
  // This ensures each refresh token is single-use, limiting replay exposure.
  const newRefreshExpiry = new Date(now + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)

  const [, newRefreshToken] = await prisma.$transaction([
    prisma.cliRefreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    }),
    prisma.cliRefreshToken.create({
      data: {
        token: crypto.randomUUID(),
        userId: user.id,
        expiresAt: newRefreshExpiry,
      },
    }),
  ])

  return NextResponse.json({
    accessToken,
    refreshToken: newRefreshToken.token,
    expiresAt: accessExpiry.toISOString(),
  })
}
