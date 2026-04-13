import { type RepoRole, ROLE_RANK } from '../types/index.js'
import type { EnvironmentType } from '../schemas/env.js'

/**
 * Returns true if `userRole` meets or exceeds `requiredRole`.
 */
export function hasRole(userRole: RepoRole, requiredRole: RepoRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole]
}

/**
 * Returns true if the user can pull vars from an env with the given minRole.
 */
export function canPull(userRole: RepoRole, minRole: RepoRole): boolean {
  return hasRole(userRole, minRole)
}

/**
 * Returns true if the user can write/delete vars in any env.
 */
export function canWrite(userRole: RepoRole): boolean {
  return hasRole(userRole, 'WRITE')
}

/**
 * Returns true if the user can perform admin actions (manage access, delete envs).
 */
export function canAdmin(userRole: RepoRole): boolean {
  return hasRole(userRole, 'ADMIN')
}

/**
 * Returns the default minimum pull role for a given environment type.
 *
 * Design principle: tighter defaults in higher-risk environments.
 *   DEVELOPMENT → READ  (any team member — fast local setup)
 *   STAGING     → WRITE (contributors+ — mirrors prod-like requirements)
 *   PRODUCTION  → ADMIN (explicit grant required — least privilege)
 *   CUSTOM      → READ  (permissive starting point, customizable per repo)
 */
export function defaultMinRoleForEnvType(type: EnvironmentType): RepoRole {
  switch (type) {
    case 'PRODUCTION':
      return 'ADMIN'
    case 'STAGING':
      return 'WRITE'
    case 'DEVELOPMENT':
    case 'CUSTOM':
    default:
      return 'READ'
  }
}
