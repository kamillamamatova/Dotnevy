import { DEFAULT_API_BASE, writeCredentials } from '../auth.js'
import { success, error, hint, blank, info, spinner, fmt } from '../output.js'
import type { CliCredentials } from '@dotenvy/shared'

const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 120_000

export async function loginCommand(): Promise<void> {
  const apiBase = DEFAULT_API_BASE

  // 1. Generate a random state token
  const state = crypto.randomUUID()

  // 2. Pre-register the state in the DB so the browser page can find it immediately.
  //    Without this step there's a race: the browser could POST before the GET
  //    creates the row (especially if the CLI-side GET polling loop hasn't run yet).
  try {
    const res = await fetch(`${apiBase}/api/tokens/cli`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
    if (!res.ok && res.status !== 409) {
      // 409 = already registered (idempotent)
      throw new Error(`Server responded with ${res.status}`)
    }
  } catch (e) {
    error(`Could not reach ${apiBase}. Is the server running?`)
    hint(`Set DOTENVY_API_BASE to override the default URL.`)
    process.exit(1)
  }

  // 3. Open the browser for GitHub OAuth
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

  // 4. Poll the API for the token
  const spin = spinner('Waiting for browser authentication')
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let lastStatus = ''

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)

    try {
      const res = await fetch(`${apiBase}/api/tokens/cli?state=${state}`)

      if (res.status === 202) {
        // Still waiting — update spinner with time remaining
        const remaining = Math.ceil((deadline - Date.now()) / 1000)
        lastStatus = `Waiting for browser authentication (${remaining}s remaining)`
        spin.update(lastStatus)
        continue
      }

      if (res.status === 410) {
        spin.stop()
        error('The login request expired. Please run dotenvy login again.')
        process.exit(1)
      }

      if (!res.ok) {
        spin.stop()
        error(`Unexpected server response: ${res.status}`)
        process.exit(1)
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
      success(`Logged in successfully.`)
      hint(`Run ${fmt.bold('dotenvy repos')} to list your repos.`)
      hint(`Run ${fmt.bold('dotenvy pull')} inside a project to pull its env vars.`)
      return
    } catch {
      // Swallow transient network errors, keep polling
    }
  }

  spin.stop()
  error('Login timed out after 2 minutes. Please try again.')
  process.exit(1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
