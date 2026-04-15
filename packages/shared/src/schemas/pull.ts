import { z } from 'zod'

// ─── Pull endpoint response contract ─────────────────────────────────────────
//
// This schema is the stable public contract for:
//   GET /api/repos/:repoId/environments/:envId/pull
//
// Both the web UI and CLI depend on this shape. The CLI uses it to write a
// local .env.local file; the web UI uses it for "copy all" or export flows.
//
// Versioning policy: fields are additive-only. Never rename or remove a field
// without a major version bump to the CLI.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A successfully pulled and decrypted variable.
 */
export const PullVariableSchema = z.object({
  key: z.string(),                    // UPPER_SNAKE_CASE variable name
  value: z.string(),                  // decrypted plaintext value
  version: z.number().int().nullable(), // null when the value came from defaultValue
  isRequired: z.boolean(),            // from VariableTemplate — CLI can warn if missing
  description: z.string().nullable(), // from VariableTemplate — for comments in .env.local
})

/**
 * A variable that was defined in the environment but could not be included.
 * reason:
 *   'no_secret_set'  — template exists but no SecretValue rows, and no defaultValue
 *   'no_permission'  — future: per-key policy denied this specific key
 */
export const SkippedVariableSchema = z.object({
  key: z.string(),
  isRequired: z.boolean(),
  reason: z.enum(['no_secret_set', 'no_permission']),
})

/**
 * Full response envelope for a pull request.
 */
export const PullEnvResponseSchema = z.object({
  meta: z.object({
    repoId: z.string(),
    repoFullName: z.string(),         // "owner/name" — for display in CLI output
    environmentId: z.string(),
    environment: z.string(),          // environment name, e.g. "development"
    environmentType: z.string(),      // "DEVELOPMENT" | "STAGING" | "PRODUCTION" | "CUSTOM"
    pulledAt: z.string(),             // ISO 8601 timestamp
    variableCount: z.number().int(),  // count of entries in `variables`
    skippedCount: z.number().int(),   // count of entries in `skipped`
    source: z.enum(['cli', 'web']),   // how the pull was initiated
  }),
  variables: z.array(PullVariableSchema),
  skipped: z.array(SkippedVariableSchema),
})

export type PullVariable = z.infer<typeof PullVariableSchema>
export type SkippedVariable = z.infer<typeof SkippedVariableSchema>
export type PullEnvResponse = z.infer<typeof PullEnvResponseSchema>
