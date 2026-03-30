import { z } from 'zod'

export const UserSchema = z.object({
  id: z.string().cuid(),
  githubId: z.number().int().positive(),
  githubLogin: z.string(),
  email: z.string().email().nullable(),
  avatarUrl: z.string().url().nullable(),
  createdAt: z.coerce.date(),
})

export type User = z.infer<typeof UserSchema>
