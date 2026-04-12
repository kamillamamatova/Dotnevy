import { z } from 'zod'
import { RepoRoleSchema } from '../types/index.js'

// ─── Environment ──────────────────────────────────────────────────────────────

export const EnvironmentTypeSchema = z.enum(['DEVELOPMENT', 'STAGING', 'PRODUCTION', 'CUSTOM'])
export type EnvironmentType = z.infer<typeof EnvironmentTypeSchema>

/**
 * minRole: the minimum 3-tier internal role a user needs to pull secrets from
 * this environment. The server maps this to a GitHubPermission when persisting
 * (READ→READ, WRITE→WRITE, ADMIN→ADMIN).
 */
export const CreateEnvironmentSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, {
      message:
        'Name must start with a letter or digit and contain only letters, digits, hyphens, or underscores',
    }),
  type: EnvironmentTypeSchema.default('CUSTOM'),
  minRole: RepoRoleSchema.default('READ'),
  description: z.string().max(500).optional(),
})

export type CreateEnvironmentInput = z.infer<typeof CreateEnvironmentSchema>

// ─── Variable templates ───────────────────────────────────────────────────────

/**
 * A template defines the shape of an environment variable — its key name,
 * documentation, and required flag. The secret VALUE is stored separately in
 * SecretValue rows (versioned, encrypted). This keeps schema definition
 * independent of runtime secrets.
 */
export const CreateTemplateSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Z_][A-Z0-9_]*$/, {
      message: 'Key must be UPPER_SNAKE_CASE — letters, digits, and underscores only',
    }),
  description: z.string().max(500).optional(),
  isRequired: z.boolean().default(false),
  // Non-secret plaintext default (e.g. PORT=3000).
  // Leave empty for secrets — use SecretValue for those.
  defaultValue: z.string().max(1000).optional(),
})

export const UpdateTemplateSchema = z.object({
  description: z.string().max(500).nullable().optional(),
  isRequired: z.boolean().optional(),
  defaultValue: z.string().max(1000).nullable().optional(),
})

export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>
export type UpdateTemplateInput = z.infer<typeof UpdateTemplateSchema>

// ─── Legacy env-set schemas (CLI compatibility) ───────────────────────────────
// The original API used "envsets" terminology. These are kept so the CLI package
// compiles while it is updated in a future phase. The web app uses
// CreateEnvironmentSchema and CreateTemplateSchema above.

export const EnvSetSchema = z.object({
  id: z.string().cuid(),
  repoId: z.string().cuid(),
  name: z.string(),
  minRole: RepoRoleSchema,
  createdAt: z.coerce.date(),
})

export const CreateEnvSetSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
  minRole: RepoRoleSchema.optional().default('READ'),
})

export const UpdateEnvSetSchema = z.object({ minRole: RepoRoleSchema })

export const EnvVarSchema = z.object({
  key: z.string().min(1).regex(/^[A-Z_][A-Z0-9_]*/),
  value: z.string(),
})

export const UpsertEnvVarSchema = z.object({
  key: EnvVarSchema.shape.key,
  value: z.string().min(0),
})

export type EnvSet = z.infer<typeof EnvSetSchema>
export type CreateEnvSetInput = z.infer<typeof CreateEnvSetSchema>
export type EnvVar = z.infer<typeof EnvVarSchema>
export type UpsertEnvVarInput = z.infer<typeof UpsertEnvVarSchema>
