import { prisma } from '@dotenvy/db'
import { type RepoRole, canAdmin, canWrite, canPull } from '@dotenvy/shared'
import { permissionToRole } from '@/lib/github'
import { syncMembership } from '@/lib/membership'

// ─── Policy evaluation engine ─────────────────────────────────────────────────
//
// Authorization is evaluated in four layers, in order:
//
//  1. Membership — no RepoMembership row → deny immediately.
//
//  2. Live re-sync for sensitive contexts:
//       - PULL from PRODUCTION environments: always re-validates against GitHub
//         before evaluating, so a revoked contributor can't hold access until
//         the 1-hour membership cache expires.
//       - ADMIN actions: always re-validate.
//       Staging and WRITE use the cached permission (1-hour TTL is acceptable
//       for those tiers).
//
//  3. Explicit AccessPolicy overrides:
//       - Environment-specific policies beat repo-wide policies (specificity wins).
//       - Within the same specificity level, DENY takes precedence over ALLOW.
//       - A matching DENY → deny immediately, regardless of role.
//       - A matching ALLOW → allow, even if the role alone wouldn't qualify.
//       - ADMIN action: policy overrides are skipped (admin is role-only).
//
//  4. Role-based fallback:
//       - PULL: canPull(role, env.minPermission)
//       - WRITE: canWrite(role)
//       - ADMIN: canAdmin(role)
//
// ─────────────────────────────────────────────────────────────────────────────

export type AccessAction = 'PULL' | 'WRITE' | 'ADMIN'

export interface AccessResult {
  allowed: boolean
  reason: string
  role: RepoRole | null
}

// Environment types where PULL triggers a live GitHub re-sync.
const LIVE_SYNC_ENV_TYPES = new Set(['PRODUCTION'])

export async function evaluateAccess(
  userId: string,
  repoId: string,
  action: AccessAction,
  envId?: string,
): Promise<AccessResult> {
  // ── 1. Membership check ──────────────────────────────────────────────────
  let membership = await prisma.repoMembership.findUnique({
    where: { userId_repoId: { userId, repoId } },
  })

  if (!membership) {
    return { allowed: false, reason: 'Not a member of this repository', role: null }
  }

  // ── 2. Live re-sync for sensitive contexts ───────────────────────────────
  if (await needsLiveSync(action, envId)) {
    await syncMembership(userId, repoId).catch(() => {})
    membership = await prisma.repoMembership.findUnique({
      where: { userId_repoId: { userId, repoId } },
    })
    if (!membership) {
      return { allowed: false, reason: 'Access revoked by GitHub', role: null }
    }
  }

  const role = permissionToRole(membership.permission)
  if (!role) {
    return {
      allowed: false,
      reason: 'GitHub permission level grants no application role',
      role: null,
    }
  }

  // ── 3. ADMIN action: role-only, no policy overrides ──────────────────────
  if (action === 'ADMIN') {
    const allowed = canAdmin(role)
    return {
      allowed,
      reason: allowed ? 'ADMIN role confirmed' : 'Requires ADMIN role',
      role,
    }
  }

  // ── 4. Explicit policy overrides ─────────────────────────────────────────
  const policyResult = await checkPolicies(userId, repoId, action, envId)
  if (policyResult !== null) return { ...policyResult, role }

  // ── 5. Role-based fallback ────────────────────────────────────────────────
  if (action === 'WRITE') {
    const allowed = canWrite(role)
    return {
      allowed,
      reason: allowed ? `Role ${role} can write` : `Requires WRITE or ADMIN role`,
      role,
    }
  }

  // action === 'PULL'
  if (!envId) {
    // No specific environment — any member can read metadata
    return { allowed: true, reason: 'Member access', role }
  }

  const env = await prisma.environment.findUnique({
    where: { id: envId },
    select: { minPermission: true },
  })
  if (!env) {
    return { allowed: false, reason: 'Environment not found', role }
  }

  const envMinRole = permissionToRole(env.minPermission) ?? 'READ'
  const allowed = canPull(role, envMinRole)
  return {
    allowed,
    reason: allowed
      ? `Role ${role} meets minimum ${envMinRole} for this environment`
      : `Role ${role} is below the ${envMinRole} minimum required for this environment`,
    role,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function needsLiveSync(action: AccessAction, envId?: string): Promise<boolean> {
  if (action === 'ADMIN') return true
  if (action !== 'PULL' || !envId) return false
  const env = await prisma.environment.findUnique({
    where: { id: envId },
    select: { type: true },
  })
  return !!env && LIVE_SYNC_ENV_TYPES.has(env.type)
}

/**
 * Checks explicit AccessPolicy rows.
 * Returns { allowed, reason } if a policy matched, null if no policy applies
 * (caller should fall through to role-based logic).
 *
 * Specificity: env-specific policies evaluated before repo-wide ones.
 * Within the same scope: DENY beats ALLOW.
 */
async function checkPolicies(
  userId: string,
  repoId: string,
  action: 'PULL' | 'WRITE',
  envId?: string,
): Promise<{ allowed: boolean; reason: string } | null> {
  const where = envId
    ? { userId, repoId, action, OR: [{ environmentId: envId }, { environmentId: null }] }
    : { userId, repoId, action, environmentId: null as string | null }

  const policies = await prisma.accessPolicy.findMany({ where })
  if (policies.length === 0) return null

  // Discard expired time-limited grants
  const now = new Date()
  const active = policies.filter((p) => !p.expiresAt || p.expiresAt > now)
  if (active.length === 0) return null

  // Env-specific policies first (more specific wins), then repo-wide
  const envSpecific = active.filter((p) => p.environmentId === envId)
  const repoWide = active.filter((p) => p.environmentId === null)

  for (const group of [envSpecific, repoWide]) {
    // Within each group: DENY beats ALLOW
    const deny = group.find((p) => p.effect === 'DENY')
    if (deny) {
      return {
        allowed: false,
        reason: deny.environmentId
          ? 'Explicit deny — this environment'
          : 'Explicit deny — repo-wide policy',
      }
    }
    const allow = group.find((p) => p.effect === 'ALLOW')
    if (allow) {
      return {
        allowed: true,
        reason: allow.environmentId
          ? 'Explicit allow — this environment'
          : 'Explicit allow — repo-wide policy',
      }
    }
  }

  return null
}
