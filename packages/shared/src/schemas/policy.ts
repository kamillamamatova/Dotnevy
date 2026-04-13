import { z } from 'zod'

/**
 * Creates a fine-grained access policy override for a specific user.
 * Admins use this to grant or deny access beyond the base role+environment rules.
 *
 * Examples:
 *   ALLOW PULL on a staging env   → lets a READ user pull staging secrets
 *   DENY  PULL on a production env → blocks a WRITE user from production
 *   DENY  WRITE on a specific env  → read-only for a contractor in that environment
 *
 * environmentId omitted = policy applies to all environments in the repo.
 */
export const CreatePolicySchema = z.object({
  userId: z.string().cuid(),
  environmentId: z.string().cuid().optional(),
  action: z.enum(['PULL', 'WRITE']),
  effect: z.enum(['ALLOW', 'DENY']),
})

export type CreatePolicyInput = z.infer<typeof CreatePolicySchema>
