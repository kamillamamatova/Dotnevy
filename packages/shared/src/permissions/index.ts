import { type RepoRole, ROLE_RANK } from '../types/index.js'

/**
 * Returns true if `userRole` meets or exceeds `requiredRole`.
 */
export function hasRole(userRole: RepoRole, requiredRole: RepoRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole]
}

/**
 * Returns true if the user can pull vars from an env set with the given minRole.
 */
export function canPull(userRole: RepoRole, minRole: RepoRole): boolean {
  return hasRole(userRole, minRole)
}

/**
 * Returns true if the user can write/delete vars in any env set.
 */
export function canWrite(userRole: RepoRole): boolean {
  return hasRole(userRole, 'WRITE')
}

/**
 * Returns true if the user can perform admin actions (manage access, delete env sets).
 */
export function canAdmin(userRole: RepoRole): boolean {
  return hasRole(userRole, 'ADMIN')
}
