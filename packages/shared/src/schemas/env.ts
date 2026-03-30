import { z } from 'zod'
import { RepoRoleSchema } from '../types/index.js'

export const EnvSetSchema = z.object({
  id: z.string().cuid(),
  repoId: z.string().cuid(),
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, {
    message: 'Name must be lowercase alphanumeric, hyphens, or underscores',
  }),
  minRole: RepoRoleSchema,
  createdAt: z.coerce.date(),
})

export const CreateEnvSetSchema = z.object({
  name: EnvSetSchema.shape.name,
  minRole: RepoRoleSchema.optional().default('READ'),
})

export const UpdateEnvSetSchema = z.object({
  minRole: RepoRoleSchema,
})

// Individual var as returned from the API after decryption
export const EnvVarSchema = z.object({
  key: z.string().min(1).regex(/^[A-Z_][A-Z0-9_]*$/, {
    message: 'Keys must be uppercase, underscores, and digits only',
  }),
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
