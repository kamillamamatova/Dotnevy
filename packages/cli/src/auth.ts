import fs from 'fs'
import path from 'path'
import type { CliCredentials } from '@pullenv/shared'

const CREDENTIALS_DIR = path.join(process.env.HOME ?? '~', '.pullenv')
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, 'credentials.json')

export const DEFAULT_API_BASE = process.env.PULLENV_API_BASE ?? 'https://pullenv.app'

export function readCredentials(): CliCredentials | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8')
    return JSON.parse(raw) as CliCredentials
  } catch {
    return null
  }
}

export function writeCredentials(creds: CliCredentials): void {
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true })
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 })
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(CREDENTIALS_PATH)
  } catch {
    // already gone
  }
}

export function isTokenExpired(creds: CliCredentials): boolean {
  const expiresAt = new Date(creds.expiresAt).getTime()
  // Refresh 60 seconds before actual expiry to avoid races
  return Date.now() >= expiresAt - 60_000
}

export async function refreshAccessToken(creds: CliCredentials): Promise<CliCredentials> {
  const res = await fetch(`${creds.apiBase}/api/tokens/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: creds.refreshToken }),
  })

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`)
  }

  const data = (await res.json()) as { accessToken: string; expiresAt: string }
  const updated: CliCredentials = { ...creds, ...data }
  writeCredentials(updated)
  return updated
}

/**
 * Returns a valid access token, refreshing it if necessary.
 * Throws if the user is not logged in.
 */
export async function getValidToken(): Promise<{ token: string; apiBase: string }> {
  let creds = readCredentials()

  if (!creds) {
    throw new Error('Not logged in. Run: pullenv login')
  }

  if (isTokenExpired(creds)) {
    creds = await refreshAccessToken(creds)
  }

  return { token: creds.accessToken, apiBase: creds.apiBase }
}
