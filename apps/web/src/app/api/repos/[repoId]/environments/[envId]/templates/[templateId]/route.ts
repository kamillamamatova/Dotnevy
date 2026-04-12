import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { UpdateTemplateSchema, canWrite } from '@pullenv/shared'
import { resolveUserRole } from '@/lib/membership'

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

  // Cascade deletes all SecretValue versions for this template
  await prisma.variableTemplate.delete({ where: { id: params.templateId } })

  return new NextResponse(null, { status: 204 })
}
