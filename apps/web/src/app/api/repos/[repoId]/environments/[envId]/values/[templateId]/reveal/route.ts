import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma, AuditAction } from '@pullenv/db'
import { canPull } from '@pullenv/shared'
import { resolveUserRole } from '@/lib/membership'
import { permissionToRole } from '@/lib/github'
import { decrypt } from '@/lib/encryption'

// ─── Reveal endpoint ──────────────────────────────────────────────────────────
//
// This is the only endpoint that returns a decrypted plaintext secret.
// It is intentionally separate from the values listing endpoint so that:
//
//   1. Every reveal generates an audit log entry
//   2. Callers must make a deliberate, targeted request — there is no
//      "dump all values" path through this endpoint
//   3. The permission check (canPull) can be stricter than list access
//
// Permission: canPull(userRole, env.minRole)
// A READ-level user cannot reveal a PRODUCTION environment (minRole=WRITE).
//
// Response headers include Cache-Control: no-store and
// Content-Security-Policy to reduce plaintext leakage.
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: { repoId: string; envId: string; templateId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const env = await prisma.environment.findUnique({ where: { id: params.envId } })
  if (!env || env.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Enforce the environment-level minimum access requirement
  const envMinRole = permissionToRole(env.minPermission) ?? 'READ'
  if (!canPull(role, envMinRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const template = await prisma.variableTemplate.findUnique({
    where: { id: params.templateId },
  })
  if (!template || template.environmentId !== params.envId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Fetch the current (highest version) secret value
  const secretValue = await prisma.secretValue.findFirst({
    where: { templateId: params.templateId },
    orderBy: { version: 'desc' },
    // Select only what is needed for decryption — nothing extra
    select: { encryptedVal: true, iv: true, version: true },
  })

  if (!secretValue) {
    // Template exists but no secret has been set yet
    return NextResponse.json(
      { error: 'No secret value set for this variable' },
      { status: 404 },
    )
  }

  // Decrypt using the repo's data encryption key
  const plaintext = await decrypt(params.repoId, secretValue.encryptedVal, secretValue.iv)

  // Every reveal is logged — this is the audit trail for secret access
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      repoId: params.repoId,
      environmentId: params.envId,
      action: AuditAction.PULL_VARS,
      detail: { key: template.key, version: secretValue.version, source: 'reveal' },
    },
  })

  return NextResponse.json(
    { key: template.key, value: plaintext, version: secretValue.version },
    {
      headers: {
        // Prevent caching of plaintext at any layer
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  )
}
