import { prisma } from '@pullenv/db'

export async function createAuditLog(
  userId: string,
  repoId: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLog.create({
    data: { userId, repoId, action, detail: detail ?? undefined },
  })
}
