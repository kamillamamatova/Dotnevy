import { jwtVerify } from 'jose'
import type { CliTokenClaims } from '@dotenvy/shared'

// Must match the secret used in POST /api/tokens/cli
const CLI_JWT_SECRET = new TextEncoder().encode(
  process.env.CLI_JWT_SECRET ?? 'dev-secret-change-me',
)

/**
 * Verifies a CLI JWT Bearer token and returns the decoded claims.
 * Returns null if the token is missing, malformed, expired, or has an invalid
 * signature — callers should treat null as "not a valid CLI token" and fall
 * through to other auth methods or return 401.
 */
export async function verifyCliToken(token: string): Promise<CliTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, CLI_JWT_SECRET, { algorithms: ['HS256'] })

    if (
      typeof payload.sub !== 'string' ||
      typeof (payload as Record<string, unknown>).githubLogin !== 'string' ||
      typeof (payload as Record<string, unknown>).repoAccess !== 'object' ||
      (payload as Record<string, unknown>).repoAccess === null
    ) {
      return null
    }

    return {
      sub: payload.sub,
      githubLogin: (payload as Record<string, unknown>).githubLogin as string,
      exp: payload.exp ?? 0,
      iat: payload.iat ?? 0,
      repoAccess: (payload as Record<string, unknown>).repoAccess as Record<string, string>,
    }
  } catch {
    // jose throws on expiry, bad signature, wrong algorithm, etc.
    return null
  }
}

/**
 * Extracts and verifies a Bearer token from an Authorization header.
 * Returns null if the header is absent or the token fails verification.
 */
export async function verifyBearerToken(
  authHeader: string | null,
): Promise<CliTokenClaims | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  return verifyCliToken(authHeader.slice(7))
}
