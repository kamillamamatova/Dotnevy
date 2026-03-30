import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@pullenv/db'
import { UpsertEnvVarSchema, canPull, canWrite } from '@pullenv/shared'
import { resolveUserRole } from '@/lib/membership'
import { decrypt, encrypt } from '@/lib/encryption'
import { createAuditLog } from '@/lib/audit'

type Params = { params: { repoId: string; setId: string } }

// GET /api/repos/:repoId/envsets/:setId/vars
// Returns decrypted vars. This endpoint must always be HTTPS in production.
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const envSet = await prisma.envSet.findUnique({ where: { id: params.setId } })
  if (!envSet || envSet.repoId !== params.repoId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!canPull(role, envSet.minRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const vars = await prisma.envVar.findMany({ where: { envSetId: params.setId } })
  const decrypted = await Promise.all(
    vars.map(async (v) => ({
      key: v.key,
      value: await decrypt(params.repoId, v.encryptedVal, v.iv),
    })),
  )

  await createAuditLog(session.user.id, params.repoId, 'pull', { envSetId: params.setId })

  return NextResponse.json(decrypted, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

// PUT /api/repos/:repoId/envsets/:setId/vars
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await resolveUserRole(session.user.id, params.repoId)
  if (!role || !canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const result = UpsertEnvVarSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ error: 'Invalid input', message: result.error.message }, { status: 400 })
  }

  const { key, value } = result.data
  const { ciphertext, iv } = await encrypt(params.repoId, value)

  const envVar = await prisma.envVar.upsert({
    where: { envSetId_key: { envSetId: params.setId, key } },
    create: { envSetId: params.setId, key, encryptedVal: ciphertext, iv },
    update: { encryptedVal: ciphertext, iv },
  })

  await createAuditLog(session.user.id, params.repoId, 'set', { envSetId: params.setId, key })

  return NextResponse.json({ key: envVar.key })
}
