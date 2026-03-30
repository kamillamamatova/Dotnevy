import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { prisma } from '@pullenv/db'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32

/**
 * Returns the master encryption key from the environment.
 * Throws on startup if the key is missing or too short.
 */
function getMasterKey(): Buffer {
  const raw = process.env.MASTER_ENCRYPTION_KEY
  if (!raw) throw new Error('MASTER_ENCRYPTION_KEY is not set')

  const key = Buffer.from(raw, 'base64')
  if (key.length < KEY_BYTES) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 bytes (base64-encoded)')
  }

  return key.subarray(0, KEY_BYTES)
}

/** Encrypt plaintext with the given key. Returns ciphertext + iv as base64 strings. */
function aesEncrypt(
  key: Buffer,
  plaintext: string,
): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

/** Decrypt base64 ciphertext (with 16-byte GCM auth tag appended) using key + iv. */
function aesDecrypt(key: Buffer, ciphertext: string, iv: string): string {
  const data = Buffer.from(ciphertext, 'base64')
  const authTag = data.subarray(data.length - 16)
  const encrypted = data.subarray(0, data.length - 16)
  const ivBuf = Buffer.from(iv, 'base64')

  const decipher = createDecipheriv(ALGORITHM, key, ivBuf)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

/** Get or create a per-repo data encryption key, wrapped with the master key. */
async function getRepoDek(repoId: string): Promise<Buffer> {
  const masterKey = getMasterKey()

  let record = await prisma.repoEncryptionKey.findUnique({ where: { repoId } })

  if (!record) {
    // Generate a new DEK and wrap it
    const dek = randomBytes(KEY_BYTES)
    const { ciphertext, iv } = aesEncrypt(masterKey, dek.toString('base64'))

    record = await prisma.repoEncryptionKey.create({
      data: { repoId, encryptedKey: ciphertext, iv },
    })
  }

  // Unwrap the DEK
  const dekBase64 = aesDecrypt(masterKey, record.encryptedKey, record.iv)
  return Buffer.from(dekBase64, 'base64')
}

/** Encrypt a plaintext value for a given repo. */
export async function encrypt(
  repoId: string,
  value: string,
): Promise<{ ciphertext: string; iv: string }> {
  const dek = await getRepoDek(repoId)
  const { ciphertext, iv } = aesEncrypt(dek, value)
  return { ciphertext, iv }
}

/** Decrypt a stored ciphertext for a given repo. */
export async function decrypt(repoId: string, ciphertext: string, iv: string): Promise<string> {
  const dek = await getRepoDek(repoId)
  return aesDecrypt(dek, ciphertext, iv)
}
