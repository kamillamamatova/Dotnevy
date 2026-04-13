import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { resolveUserRole } from '@/lib/membership'

// GET /api/repos/:repoId/environments/:envId/values/:templateId/history
//
// Returns the full version history for a secret variable — metadata only.
// Ciphertext and IV are never included in this response.
//
// This endpoint separates "current active SecretValue" from "revision history":
//   - The values listing endpoint shows only the current (latest) version
//   - This endpoint exposes the full audit trail of writes
//
// Permission: any authenticated repo member (READ+).
// Knowing when a secret was rotated and by whom is useful for all team members,
// even those who cannot pull the actual value.

type Params = { params: { repoId: string; envId: string; templateId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const template = await prisma.variableTemplate.findUnique({
    where: { id: params.templateId },
    include: { environment: true },
  })

  if (
    !template ||
    template.environmentId !== params.envId ||
    template.environment.repoId !== params.repoId
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const versions = await prisma.secretValue.findMany({
    where: { templateId: params.templateId },
    orderBy: { version: 'desc' },
    // Explicitly select only metadata fields — no ciphertext
    select: {
      version: true,
      createdAt: true,
      createdBy: { select: { githubLogin: true } },
      // encryptedVal and iv intentionally excluded
    },
  })

  return NextResponse.json({
    templateId: params.templateId,
    key: template.key,
    totalVersions: versions.length,
    versions: versions.map((v) => ({
      version: v.version,
      createdAt: v.createdAt.toISOString(),
      createdBy: v.createdBy.githubLogin,
    })),
  })
}
