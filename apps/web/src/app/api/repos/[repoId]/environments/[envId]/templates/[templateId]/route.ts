import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@dotenvy/db'
import { UpdateTemplateSchema, canWrite } from '@dotenvy/shared'
import { resolveUserRole } from '@/lib/membership'
import { logAudit } from '@/lib/audit'

// ─── Permission note ──────────────────────────────────────────────────────────
// PATCH  — members with WRITE or ADMIN role only
// DELETE — members with WRITE or ADMIN role only
//
// The key field is intentionally immutable. If a key name needs to change,
// delete and recreate the template. This preserves audit trail integrity and
// prevents secret value history from becoming ambiguous.
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: { repoId: string; envId: string; templateId: string } }

// PATCH /api/repos/:repoId/environments/:envId/templates/:templateId
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  const body = await req.json()
  const parsed = UpdateTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', message: parsed.error.message },
      { status: 400 },
    )
  }

  const updated = await prisma.variableTemplate.update({
    where: { id: params.templateId },
    data: {
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(parsed.data.isRequired !== undefined && { isRequired: parsed.data.isRequired }),
      ...(parsed.data.defaultValue !== undefined && { defaultValue: parsed.data.defaultValue }),
    },
  })

  // Record which fields were touched — not their new values
  const changes: Array<'description' | 'isRequired' | 'defaultValue'> = []
  if (parsed.data.description !== undefined) changes.push('description')
  if (parsed.data.isRequired !== undefined) changes.push('isRequired')
  if (parsed.data.defaultValue !== undefined) changes.push('defaultValue')

  if (changes.length > 0) {
    await logAudit({
      userId: session.user.id,
      repoId: params.repoId,
      environmentId: params.envId,
      event: {
        action: 'UPDATE_TEMPLATE',
        detail: { key: template.key, changes, environmentName: template.environment.name },
      },
    })
  }

  return NextResponse.json(updated)
}

// DELETE /api/repos/:repoId/environments/:envId/templates/:templateId
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  // Count versions before the cascade so the audit record is meaningful
  const versionCount = await prisma.secretValue.count({
    where: { templateId: params.templateId },
  })

  // Cascade deletes all SecretValue versions for this template
  await prisma.variableTemplate.delete({ where: { id: params.templateId } })

  await logAudit({
    userId: session.user.id,
    repoId: params.repoId,
    environmentId: params.envId,
    event: {
      action: 'DELETE_TEMPLATE',
      detail: {
        key: template.key,
        versionCount,
        environmentName: template.environment.name,
      },
    },
  })

  return new NextResponse(null, { status: 204 })
}
