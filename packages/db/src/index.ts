import { PrismaClient } from '@prisma/client'

// Prevent multiple PrismaClient instances in development (Next.js hot reload)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

// Enums
export { GitHubPermission, AuditAction, EnvironmentType, PolicyEffect, PolicyAction } from '@prisma/client'

// Types
export type {
  User,
  Account,
  Session,
  GitHubInstallation,
  Repo,
  RepoMembership,
  Environment,
  VariableTemplate,
  SecretValue,
  RepoEncryptionKey,
  AccessPolicy,
  AuditLog,
} from '@prisma/client'
