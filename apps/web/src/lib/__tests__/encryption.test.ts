/**
 * Tests for the encryption service.
 *
 * Uses an in-memory mock for Prisma so tests run without a real database.
 * MASTER_ENCRYPTION_KEY is set in vitest.config.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@dotenvy/db'

// ─── Mock @dotenvy/db ─────────────────────────────────────────────────────────
// Must be hoisted (vi.mock is moved to top of file by vitest's transformer).
vi.mock('@dotenvy/db', () => ({
  prisma: {
    repoEncryptionKey: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}))

// Import after mock is registered
const { encrypt, decrypt } = await import('../encryption.js')

// ─── Per-test in-memory DEK store ─────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks() // reset call counts between tests

  const store = new Map<string, { repoId: string; encryptedKey: string; iv: string }>()

  vi.mocked(prisma.repoEncryptionKey.findUnique).mockImplementation(
    // @ts-expect-error — mock doesn't match full Prisma signature
    ({ where }: { where: { repoId: string } }) =>
      Promise.resolve(store.get(where.repoId) ?? null),
  )

  vi.mocked(prisma.repoEncryptionKey.create).mockImplementation(
    // @ts-expect-error — mock doesn't match full Prisma signature
    ({ data }: { data: { repoId: string; encryptedKey: string; iv: string } }) => {
      const record = { repoId: data.repoId, encryptedKey: data.encryptedKey, iv: data.iv }
      store.set(data.repoId, record)
      return Promise.resolve(record)
    },
  )
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('encrypt / decrypt roundtrip', () => {
  it('roundtrips a simple string', async () => {
    const { ciphertext, iv } = await encrypt('repo-a', 'hello world')
    const plaintext = await decrypt('repo-a', ciphertext, iv)
    expect(plaintext).toBe('hello world')
  })

  it('roundtrips an empty string', async () => {
    const { ciphertext, iv } = await encrypt('repo-b', '')
    const plaintext = await decrypt('repo-b', ciphertext, iv)
    expect(plaintext).toBe('')
  })

  it('roundtrips a multiline secret with special characters', async () => {
    const secret = 'SECRET_KEY="abc123"\nDB_URL="postgres://user:p@ss@localhost/db"'
    const { ciphertext, iv } = await encrypt('repo-c', secret)
    const plaintext = await decrypt('repo-c', ciphertext, iv)
    expect(plaintext).toBe(secret)
  })

  it('produces different ciphertexts for identical plaintexts (fresh IV per call)', async () => {
    const { ciphertext: ct1 } = await encrypt('repo-d', 'same-value')
    const { ciphertext: ct2 } = await encrypt('repo-d', 'same-value')
    // Different random IVs → different ciphertexts
    expect(ct1).not.toBe(ct2)
  })

  it('decryption fails with wrong IV', async () => {
    const { ciphertext } = await encrypt('repo-e', 'sensitive')
    const wrongIv = Buffer.alloc(12).toString('base64')
    await expect(decrypt('repo-e', ciphertext, wrongIv)).rejects.toThrow()
  })

  it('decryption fails with tampered ciphertext', async () => {
    const { ciphertext, iv } = await encrypt('repo-f', 'sensitive')
    const tampered = Buffer.from(ciphertext, 'base64')
    tampered[0] ^= 0xff // flip bits
    await expect(decrypt('repo-f', tampered.toString('base64'), iv)).rejects.toThrow()
  })
})

describe('DEK creation and reuse', () => {
  it('creates a new DEK for a repo on first encrypt', async () => {
    await encrypt('repo-new', 'value')
    expect(vi.mocked(prisma.repoEncryptionKey.create)).toHaveBeenCalledOnce()
  })

  it('reuses the existing DEK on subsequent calls', async () => {
    await encrypt('repo-reuse', 'first')
    await encrypt('repo-reuse', 'second')
    // create called once (first call), findUnique returns the stored DEK on second call
    expect(vi.mocked(prisma.repoEncryptionKey.create)).toHaveBeenCalledOnce()
  })
})
