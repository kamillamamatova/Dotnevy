/**
 * resolveRequestAuth — unified auth resolution for API routes.
 *
 * All routes that must be callable by both the web UI (NextAuth session cookie)
 * and the CLI (JWT Bearer token) call this once at the top of the handler.
 *
 * Priority: session cookie first (avoids the JWT parse cost on browser requests),
 * then Bearer token.
 *
 * Returns null if neither method yields a valid identity; the caller should
 * return 401.
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { verifyBearerToken } from '@/lib/cli-auth'

export interface RequestAuth {
  userId: string
  source: 'web' | 'cli'
}

export async function resolveRequestAuth(req: NextRequest): Promise<RequestAuth | null> {
  // 1. NextAuth session (browser / web UI)
  const session = await getServerSession(authOptions)
  if (session?.user?.id) {
    return { userId: session.user.id, source: 'web' }
  }

  // 2. JWT Bearer token (CLI)
  const claims = await verifyBearerToken(req.headers.get('Authorization'))
  if (claims?.sub) {
    return { userId: claims.sub, source: 'cli' }
  }

  return null
}
