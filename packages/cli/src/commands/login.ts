import { DEFAULT_API_BASE, writeCredentials } from '../auth.js'
import { success, error, hint, blank, info, spinner, fmt } from '../output.js'
import type { CliCredentials } from '@pullenv/shared'

const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 120_000

export async function loginCommand(): Promise<void> {
  const apiBase = DEFAULT_API_BASE

  // 1. Generate a random state token
  const state = crypto.randomUUID()

  // 2. Open the browser for GitHub OAuth
  const loginUrl = `${apiBase}/cli-auth?state=${state}`
  blank()
  info('Opening browser for GitHub login...')
  hint(loginUrl)
  blank()
  hint(`If the browser did not open, visit the URL above manually.`)
  blank()

  try {
    const { default: open } = await import('open')
    await open(loginUrl)
  } catch {
    // Non-fatal: user can open manually
  }

  // 3. Poll the API for the token
  const spin = spinner('Waiting for authentication')
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
      spin.stop()
      blank()
      success(`Logged in! Run ${fmt.bold('pullenv repos')} to see your repos.`)
      return
    } catch {
      // Swallow transient network errors, keep polling
    }
  }

  spin.stop()
  error('Login timed out. Please try again.')
  process.exit(1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
