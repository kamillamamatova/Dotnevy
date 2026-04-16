/**
 * Credential storage and token lifecycle management.
 *
 * Credentials are stored in ~/.dotenvy/credentials.json with mode 0600.
 * The file holds:
 *   - accessToken  — short-lived JWT (15 min), used as Bearer on every API call
 *   - refreshToken — opaque UUID (30 days), used to get a new access token
 *   - expiresAt    — ISO 8601 expiry of the access token
 *   - apiBase      — the Dotenvy server URL (defaults to https://dotenvy.app)
 *
 * Security note: ~/.dotenvy/credentials.json is mode 0600 (owner-read-only).
 * The access token is a signed JWT — it cannot be forged without CLI_JWT_SECRET.
 * The refresh token is stored in the DB and can be revoked server-side.
 */

import fs from 'fs'
import path from 'path'
import type { CliCredentials } from '@dotenvy/shared'

const CREDENTIALS_DIR = path.join(process.env.HOME ?? '~', '.dotenvy')
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, 'credentials.json')

export const DEFAULT_API_BASE = process.env.DOTENVY_API_BASE ?? 'https://dotenvy.app'

// ─── Credential I/O ───────────────────────────────────────────────────────────

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

/**
 * Removes the credentials file and optionally revokes the refresh token
 * on the server so it can no longer be used.
 */
export async function clearCredentials(serverRevoke = true): Promise<void> {
  const creds = readCredentials()

  // Server-side revocation: mark the refresh token as revoked in the DB.
  // Even if this fails (offline, etc.), the local credentials are still deleted.
  if (serverRevoke && creds?.refreshToken) {
    try {
      await fetch(`${creds.apiBase}/api/tokens/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: creds.refreshToken }),
      })
    } catch {
      // Non-fatal — local logout still succeeds
    }
  }

  try {
    fs.unlinkSync(CREDENTIALS_PATH)
  } catch {
    // Already gone
  }
}

// ─── Token lifecycle ──────────────────────────────────────────────────────────

/**
 * Returns true if the stored access token is expired (or within 60 s of expiry).
 * The 60-second buffer avoids token-expired races on slow networks.
 */
export function isTokenExpired(creds: CliCredentials): boolean {
  const expiresAt = new Date(creds.expiresAt).getTime()
  return Date.now() >= expiresAt - 60_000
}

/**
 * Exchanges the stored refresh token for a new access token.
 * Rotates the refresh token: the server invalidates the old one and returns a new one.
 * Throws if the refresh fails (expired, revoked, or network error).
 */
export async function refreshAccessToken(creds: CliCredentials): Promise<CliCredentials> {
  const res = await fetch(`${creds.apiBase}/api/tokens/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: creds.refreshToken }),
  })

  if (res.status === 401) {
    // Refresh token revoked or expired — user must log in again
    throw new RefreshExpiredError()
  }

  if (!res.ok) {
    throw new Error(`Token refresh failed: HTTP ${res.status}`)
  }

  const data = (await res.json()) as {
    accessToken: string
    refreshToken: string
    expiresAt: string
  }

  const updated: CliCredentials = { ...creds, ...data }
  writeCredentials(updated)
  return updated
}

/**
 * Returns a valid access token, refreshing automatically if needed.
 * Throws `NotLoggedInError` when no credentials exist.
 * Throws `RefreshExpiredError` when the refresh token is expired/revoked.
 */
export async function getValidToken(): Promise<{ token: string; apiBase: string }> {
  let creds = readCredentials()

  if (!creds) {
    throw new NotLoggedInError()
  }

  if (isTokenExpired(creds)) {
    creds = await refreshAccessToken(creds)
  }

  return { token: creds.accessToken, apiBase: creds.apiBase }
}

// ─── Typed errors ─────────────────────────────────────────────────────────────

export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in. Run: dotenvy login')
    this.name = 'NotLoggedInError'
  }
}

export class RefreshExpiredError extends Error {
  constructor() {
    super('Your session has expired. Run: dotenvy login')
    this.name = 'RefreshExpiredError'
  }
}
