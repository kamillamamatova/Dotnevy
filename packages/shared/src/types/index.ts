import { z } from 'zod'

// Mirrors the Prisma RepoRole enum so shared code doesn't import from @pullenv/db
export const RepoRoleSchema = z.enum(['READ', 'WRITE', 'ADMIN'])
export type RepoRole = z.infer<typeof RepoRoleSchema>

// Role ordering for comparisons
export const ROLE_RANK: Record<RepoRole, number> = {
  READ: 0,
  WRITE: 1,
  ADMIN: 2,
}

// CLI token payload stored in ~/.pullenv/credentials.json
export interface CliCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: string // ISO 8601
  apiBase: string
}

// JWT claims issued to the CLI
export interface CliTokenClaims {
  sub: string          // user cuid
  githubLogin: string
  exp: number
  iat: number
  repoAccess: Record<string, RepoRole>  // repoId -> role
}

// Standard API error shape
export interface ApiError {
  error: string
  message?: string
}
