import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pullenv/db'

// ─── POST /api/tokens/revoke ──────────────────────────────────────────────────
//
// Revokes a refresh token so it can no longer be used to obtain new JWTs.
// The short-lived access token (JWT) will remain valid until it expires (≤15 min)
// since JWTs are stateless — this is a known tradeoff of the JWT model.
//
// Called by `pullenv logout` to invalidate the session on the server side.
//
// Body: { refreshToken: string }
// Response: 200 { ok: true }  — even if the token wasn't found (idempotent)
//
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const token = body?.refreshToken
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Missing refreshToken' }, { status: 400 })
  }

  // Idempotent: silently succeed if already revoked or not found
  await prisma.cliRefreshToken.updateMany({
    where: {
      token,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
