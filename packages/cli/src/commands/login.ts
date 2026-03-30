import { DEFAULT_API_BASE, writeCredentials } from '../auth.js'
import type { CliCredentials } from '@pullenv/shared'

const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 120_000

export async function loginCommand(): Promise<void> {
  const apiBase = DEFAULT_API_BASE

  // 1. Generate a random state token
  const state = crypto.randomUUID()

  // 2. Open the browser for GitHub OAuth
  const loginUrl = `${apiBase}/cli-auth?state=${state}`
  console.log(`\nOpening browser for GitHub login...\n  ${loginUrl}\n`)
  console.log('If the browser did not open, visit the URL above manually.\n')

  try {
    const { default: open } = await import('open')
    await open(loginUrl)
  } catch {
    // Non-fatal: user can open manually
  }

  // 3. Poll the API for the token
  console.log('Waiting for authentication...')
  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)

    try {
      const res = await fetch(`${apiBase}/api/tokens/cli?state=${state}`)

      if (res.status === 202) {
        // Still waiting
        continue
      }

      if (!res.ok) {
        throw new Error(`Unexpected response: ${res.status}`)
      }

      const data = (await res.json()) as {
        accessToken: string
        refreshToken: string
        expiresAt: string
      }

      const creds: CliCredentials = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        apiBase,
      }

      writeCredentials(creds)
      console.log('\nLogged in successfully.')
      return
    } catch (err) {
      // Swallow transient network errors, keep polling
    }
  }

  throw new Error('Login timed out. Please try again.')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
