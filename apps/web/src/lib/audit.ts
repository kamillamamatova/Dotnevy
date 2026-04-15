import { prisma, AuditAction } from '@pullenv/db'

// ─── Typed audit service ──────────────────────────────────────────────────────
//
// All writes to the AuditLog table go through `logAudit()`. This enforces:
//
//   1. A consistent metadata shape per action — no ad-hoc JSON blobs
//   2. An explicit safety rule: plaintext secret values are never included
//   3. A stable set of field names that downstream consumers can query/alert on
//
// To add a new event type:
//   1. Add a value to AuditAction in schema.prisma (and run prisma migrate dev)
//   2. Add a detail type below
//   3. Add a union arm to AuditEvent
//
// ─── What is intentionally excluded from metadata ─────────────────────────────
//
// - Plaintext secret values (never logged at any level)
// - Encrypted ciphertext or IVs
// - Session tokens, access tokens, or credential material
// - Passwords or private keys of any kind
// - The "previous value" of a secret (even as a hash)
//
// For secrets, only the key name and version number are safe to log.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Per-action detail shapes ─────────────────────────────────────────────────

export type PullVarsDetail =
  | {
      // Single-variable reveal (the /reveal endpoint)
      key: string
      version: number
      environmentName: string
      source: 'reveal'
    }
  | {
      // Bulk pull (the /pull endpoint — CLI or web)
      keys: string[]           // key names of successfully pulled variables
      variableCount: number    // pulled count
      skippedCount: number     // templates with no value or skipped by policy
      environmentName: string
      source: 'cli' | 'web' | 'export'
    }

export type SetVarDetail = {
  key: string
  version: number
  previousVersion: number | null
  environmentName: string
}

export type DeleteVarDetail = {
  key: string
  environmentName: string
}

export type CreateTemplateDetail = {
  key: string
  isRequired: boolean
  hasDefault: boolean     // bool, not the default value itself
  environmentName: string
}

export type UpdateTemplateDetail = {
  key: string
  // Which fields changed — not the new values (defaultValue could be sensitive)
  changes: Array<'description' | 'isRequired' | 'defaultValue'>
  environmentName: string
}

export type DeleteTemplateDetail = {
  key: string
  versionCount: number    // how many SecretValue rows were cascade-deleted
  environmentName: string
}

export type CreateEnvironmentDetail = {
  name: string
  type: string            // EnvironmentType
  minRole: string         // RepoRole
}

export type UpdateEnvironmentDetail = {
  name: string
  changes: Array<'minRole' | 'description'>
  newMinRole?: string     // safe to log — it's an access policy, not a secret
}

export type DeleteEnvironmentDetail = {
  name: string
  type: string
  templateCount: number
}

export type GrantAccessDetail = {
  targetUser: string      // githubLogin of the affected user
  policyAction: string    // 'PULL' | 'WRITE'
  effect: string          // 'ALLOW' | 'DENY'
  scope: 'environment' | 'repo'
  environmentName?: string
}

export type RevokeAccessDetail = {
  targetUser: string
  removedEffect?: string
  removedAction?: string
  scope: 'environment' | 'repo'
  environmentName?: string
}

export type RegisterRepoDetail = {
  owner: string
  name: string
}

export type RemoveRepoDetail = {
  owner: string
  name: string
}

// ─── Discriminated union ──────────────────────────────────────────────────────

export type AuditEvent =
  | { action: 'PULL_VARS'; detail: PullVarsDetail }
  | { action: 'SET_VAR'; detail: SetVarDetail }
  | { action: 'DELETE_VAR'; detail: DeleteVarDetail }
  | { action: 'CREATE_TEMPLATE'; detail: CreateTemplateDetail }
  | { action: 'UPDATE_TEMPLATE'; detail: UpdateTemplateDetail }
  | { action: 'DELETE_TEMPLATE'; detail: DeleteTemplateDetail }
  | { action: 'CREATE_ENVIRONMENT'; detail: CreateEnvironmentDetail }
  | { action: 'UPDATE_ENVIRONMENT'; detail: UpdateEnvironmentDetail }
  | { action: 'DELETE_ENVIRONMENT'; detail: DeleteEnvironmentDetail }
  | { action: 'GRANT_ACCESS'; detail: GrantAccessDetail }
  | { action: 'REVOKE_ACCESS'; detail: RevokeAccessDetail }
  | { action: 'REGISTER_REPO'; detail: RegisterRepoDetail }
  | { action: 'REMOVE_REPO'; detail: RemoveRepoDetail }

export interface LogAuditOptions {
  userId: string
  repoId: string
  environmentId?: string
  event: AuditEvent
}

/**
 * Writes a structured, typed audit log entry.
 * Non-throwing — failures are silent so a logging error never breaks the main request.
 * Callers can await this if they need the log written before responding, or
 * fire-and-forget with `.catch(() => {})` for non-critical paths.
 */
export async function logAudit(opts: LogAuditOptions): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: opts.userId,
      repoId: opts.repoId,
      environmentId: opts.environmentId ?? null,
      action: opts.event.action as AuditAction,
      detail: opts.event.detail,
    },
  })
}
