/**
 * Encryption service — application-level encryption for secret values.
 *
 * ─── Architecture: envelope encryption ───────────────────────────────────────
 *
 * Two key tiers:
 *
 *   1. MASTER KEY  (MASTER_ENCRYPTION_KEY env var, never stored in DB)
 *      A 32-byte AES-256 key held only in the process environment.
 *      Its sole job is to wrap/unwrap per-repo DEKs.
 *
 *   2. DATA ENCRYPTION KEY (DEK)  (stored encrypted in RepoEncryptionKey)
 *      A 32-byte AES-256 key generated randomly per repo.
 *      All SecretValue rows for a repo are encrypted with the repo's DEK.
 *      The DEK is stored AES-256-GCM encrypted under the master key.
 *
 * Algorithm: AES-256-GCM with a random 12-byte IV per encryption.
 * The GCM auth tag (16 bytes) is appended to the ciphertext in the same
 * base64 blob so the IV and ciphertext are the only two fields needed for
 * decryption.
 *
 * ─── Swappability ────────────────────────────────────────────────────────────
 *
 * The public API — `encrypt(repoId, value)` and `decrypt(repoId, ct, iv)` —
 * is the seam. To swap to a KMS (e.g. AWS KMS, GCP CKMS):
 *   - Replace `getRepoDek` with a KMS data-key call
 *   - Keep the `encrypt` / `decrypt` signatures identical
 *   - Existing ciphertext rows remain decryptable during migration because
 *     the DEK is always fetched fresh; you'd just change how the DEK is
 *     protected, then re-encrypt all DEKs under the new wrapping key.
 *
 * ─── What is NOT covered here ────────────────────────────────────────────────
 *
 * - Key rotation: rotating MASTER_ENCRYPTION_KEY requires re-wrapping all
 *   RepoEncryptionKey rows. See SECURITY.md (future) for the rotation plan.
 * - HSM / hardware key storage: not used in the MVP; add via KMS integration.
 * - Client-side encryption: values are plaintext at the HTTP layer and only
 *   encrypted before the DB write. TLS must be enforced end-to-end.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { prisma } from '@dotenvy/db'

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
