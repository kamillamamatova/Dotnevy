/**
 * Tests for the 4-layer access policy engine (evaluateAccess).
 *
 * Mocks Prisma and membership sync so no DB or GitHub API calls occur.
 * GitHubPermission enum values are inlined (Prisma string enums) to avoid
 * triggering PrismaClient initialisation in the mock factory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── GitHubPermission inline (mirrors @prisma/client enum) ───────────────────
// Prisma string enums are just string literals at runtime. Inlining avoids
// importing the actual @dotenvy/db module in the mock factory, which would
// trigger PrismaClient initialisation (and a DATABASE_URL requirement).

const GitHubPermission = {
  NONE: 'NONE',
  READ: 'READ',
  TRIAGE: 'TRIAGE',
  WRITE: 'WRITE',
  MAINTAIN: 'MAINTAIN',
  ADMIN: 'ADMIN',
} as const
type GitHubPermissionValue = (typeof GitHubPermission)[keyof typeof GitHubPermission]

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@dotenvy/db', () => ({
  GitHubPermission,
  prisma: {
    repoMembership: { findUnique: vi.fn() },
    accessPolicy: { findMany: vi.fn() },
    environment: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/membership', () => ({
  syncMembership: vi.fn().mockResolvedValue(undefined),
}))

const { prisma } = await import('@dotenvy/db')
const { evaluateAccess } = await import('../policy.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function membership(permission: GitHubPermissionValue) {
  return { userId: 'u1', repoId: 'r1', permission, syncedAt: new Date() }
}

function env(type: string, minPermission: GitHubPermissionValue) {
  return { id: 'env1', repoId: 'r1', type, minPermission }
}

function policy(overrides: Partial<{
  environmentId: string | null
  action: string
  effect: string
  expiresAt: Date | null
}>) {
  return {
    id: 'p1',
    userId: 'u1',
    repoId: 'r1',
    membershipId: 'm1',
    environmentId: null,
    action: 'PULL',
    effect: 'ALLOW',
    expiresAt: null,
    note: null,
    createdAt: new Date(),
    ...overrides,
  }
}

// ─── Layer 1: Membership check ────────────────────────────────────────────────

describe('layer 1 — membership', () => {
  it('denies when user has no membership', async () => {
    vi.mocked(prisma.repoMembership.findUnique).mockResolvedValue(null)
    const result = await evaluateAccess('u1', 'r1', 'PULL')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/not a member/i)
    expect(result.role).toBeNull()
  })
})

// ─── Layer 4: Role-based fallback (PULL) ─────────────────────────────────────

describe('layer 4 — role-based fallback (PULL)', () => {
  beforeEach(() => {
    vi.mocked(prisma.accessPolicy.findMany).mockResolvedValue([])
  })

  it('allows READ user to pull from a READ-minimum environment', async () => {
    vi.mocked(prisma.repoMembership.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      membership(GitHubPermission.READ),
    )
    vi.mocked(prisma.environment.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      env('DEVELOPMENT', GitHubPermission.READ),
    )
    const result = await evaluateAccess('u1', 'r1', 'PULL', 'env1')
    expect(result.allowed).toBe(true)
    expect(result.role).toBe('READ')
  })

  it('denies READ user from a WRITE-minimum environment', async () => {
    vi.mocked(prisma.repoMembership.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      membership(GitHubPermission.READ),
    )
    vi.mocked(prisma.environment.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      env('STAGING', GitHubPermission.WRITE),
    )
    const result = await evaluateAccess('u1', 'r1', 'PULL', 'env1')
    expect(result.allowed).toBe(false)
    expect(result.role).toBe('READ')
  })

  it('denies WRITE user from an ADMIN-minimum environment', async () => {
    vi.mocked(prisma.repoMembership.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      membership(GitHubPermission.WRITE),
    )
    vi.mocked(prisma.environment.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      env('PRODUCTION', GitHubPermission.ADMIN),
    )
    const result = await evaluateAccess('u1', 'r1', 'PULL', 'env1')
    expect(result.allowed).toBe(false)
    expect(result.role).toBe('WRITE')
  })

  it('allows ADMIN user to pull from any environment', async () => {
    vi.mocked(prisma.repoMembership.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      membership(GitHubPermission.ADMIN),
    )
    vi.mocked(prisma.environment.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      env('PRODUCTION', GitHubPermission.ADMIN),
    )
    const result = await evaluateAccess('u1', 'r1', 'PULL', 'env1')
    expect(result.allowed).toBe(true)
    expect(result.role).toBe('ADMIN')
  })
})

// ─── Layer 4: Role-based fallback (WRITE / ADMIN) ────────────────────────────

describe('layer 4 — role-based fallback (WRITE / ADMIN)', () => {
  beforeEach(() => {
    vi.mocked(prisma.accessPolicy.findMany).mockResolvedValue([])
  })

  it('allows WRITE user to write', async () => {
    vi.mocked(prisma.repoMembership.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      membership(GitHubPermission.WRITE),
    )
    const result = await evaluateAccess('u1', 'r1', 'WRITE')
    expect(result.allowed).toBe(true)
  })

  it('denies READ user from writing', async () => {
    vi.mocked(prisma.repoMembership.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      membership(GitHubPermission.READ),
    )
    const result = await evaluateAccess('u1', 'r1', 'WRITE')
    expect(result.allowed).toBe(false)
  })

  it('denies WRITE user from admin actions', async () => {
    vi.mocked(prisma.repoMembership.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      membership(GitHubPermission.WRITE),
    )
    const result = await evaluateAccess('u1', 'r1', 'ADMIN')
    expect(result.allowed).toBe(false)
  })

  it('allows ADMIN user for admin actions', async () => {
    vi.mocked(prisma.repoMembership.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      membership(GitHubPermission.ADMIN),
    )
    const result = await evaluateAccess('u1', 'r1', 'ADMIN')
    expect(result.allowed).toBe(true)
  })
})

// ─── Layer 3: Explicit policy overrides ──────────────────────────────────────

describe('layer 3 — explicit policy overrides', () => {
  beforeEach(() => {
    // READ role — would normally be denied from WRITE-min env
    vi.mocked(prisma.repoMembership.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      membership(GitHubPermission.READ),
    )
    vi.mocked(prisma.environment.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      env('STAGING', GitHubPermission.WRITE),
    )
  })

  it('ALLOW policy grants access beyond role', async () => {
    vi.mocked(prisma.accessPolicy.findMany).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      [policy({ environmentId: 'env1', action: 'PULL', effect: 'ALLOW' })],
    )
    const result = await evaluateAccess('u1', 'r1', 'PULL', 'env1')
    expect(result.allowed).toBe(true)
    expect(result.reason).toMatch(/explicit allow/i)
  })

  it('DENY policy overrides even a sufficient role', async () => {
    vi.mocked(prisma.repoMembership.findUnique).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      membership(GitHubPermission.ADMIN),
    )
    vi.mocked(prisma.accessPolicy.findMany).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      [policy({ environmentId: 'env1', action: 'PULL', effect: 'DENY' })],
    )
    const result = await evaluateAccess('u1', 'r1', 'PULL', 'env1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/explicit deny/i)
  })

  it('env-specific DENY beats repo-wide ALLOW', async () => {
    vi.mocked(prisma.accessPolicy.findMany).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      [
        policy({ environmentId: 'env1', action: 'PULL', effect: 'DENY' }),
        policy({ environmentId: null, action: 'PULL', effect: 'ALLOW' }),
      ],
    )
    const result = await evaluateAccess('u1', 'r1', 'PULL', 'env1')
    expect(result.allowed).toBe(false)
  })

  it('expired ALLOW policy is ignored (falls through to role check)', async () => {
    const expired = new Date(Date.now() - 1000)
    vi.mocked(prisma.accessPolicy.findMany).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      [policy({ environmentId: 'env1', action: 'PULL', effect: 'ALLOW', expiresAt: expired })],
    )
    // READ user, WRITE-min env — denied by role after expired policy is skipped
    const result = await evaluateAccess('u1', 'r1', 'PULL', 'env1')
    expect(result.allowed).toBe(false)
  })

  it('active (non-expired) ALLOW policy is respected', async () => {
    const future = new Date(Date.now() + 86_400_000)
    vi.mocked(prisma.accessPolicy.findMany).mockResolvedValue(
      // @ts-expect-error — mock uses simplified type
      [policy({ environmentId: 'env1', action: 'PULL', effect: 'ALLOW', expiresAt: future })],
    )
    const result = await evaluateAccess('u1', 'r1', 'PULL', 'env1')
    expect(result.allowed).toBe(true)
  })
})
