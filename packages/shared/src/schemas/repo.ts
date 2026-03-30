import { z } from 'zod'
import { RepoRoleSchema } from '../types/index.js'

export const RepoSchema = z.object({
  id: z.string().cuid(),
  githubRepoId: z.number().int().positive(),
  owner: z.string(),
  name: z.string(),
  installationId: z.number().int().positive(),
  createdAt: z.coerce.date(),
})

export const RepoWithRoleSchema = RepoSchema.extend({
  role: RepoRoleSchema,
})

export const RegisterRepoSchema = z.object({
  githubRepoId: z.number().int().positive(),
  owner: z.string().min(1),
  name: z.string().min(1),
  installationId: z.number().int().positive(),
})

export type Repo = z.infer<typeof RepoSchema>
export type RepoWithRole = z.infer<typeof RepoWithRoleSchema>
export type RegisterRepoInput = z.infer<typeof RegisterRepoSchema>
