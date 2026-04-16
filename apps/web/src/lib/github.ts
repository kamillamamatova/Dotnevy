/**
 * GitHub service — isolated abstraction for all GitHub API interactions.
 *
 * ─── Architecture: User Auth vs GitHub App (two separate flows) ──────────────
 *
 * USER AUTH  (lib/auth.ts)
 *   GitHub OAuth authenticates individual users. We get their identity
 *   (githubId, githubLogin) but do NOT store their OAuth access token and
 *   do NOT request repo-scoped OAuth scopes. Scopes: read:user, user:email.
 *
 * GITHUB APP  (this file)
 *   A GitHub App installation grants Dotenvy access to specific repos on
 *   behalf of an org or user account. We authenticate as the App using a
 *   short-lived RS256 JWT signed with the App private key, then exchange it
 *   for a per-installation access token scoped to those repos.
 *
 *   Required env vars (all optional for dev — see graceful fallback below):
 *     GITHUB_APP_ID           numeric App ID from the App settings page
 *     GITHUB_APP_PRIVATE_KEY  RSA private key PEM (literal \n ok in env var)
 *
 *   When these are absent, installation-token-dependent calls return null and
 *   callers skip the live sync, refreshing only the syncedAt timestamp.
 *
 * ─── Permission model ────────────────────────────────────────────────────────
 *
 *   GitHub exposes 6 levels: NONE, READ, TRIAGE, WRITE, MAINTAIN, ADMIN.
 *   Internally Dotenvy uses 3 tiers: READ, WRITE, ADMIN (null = no access).
 *
 *   Mapping:
 *     NONE                 → null  (deny)
 *     READ | TRIAGE        → READ  (read-only)
 *     WRITE | MAINTAIN     → WRITE (can manage vars)
 *     ADMIN                → ADMIN (full control)
 *
 *   The full GitHubPermission is persisted in RepoMembership so the mapping
 *   can be adjusted without a data migration.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { SignJWT, importPKCS8 } from 'jose'
import { GitHubPermission } from '@dotenvy/db'
import type { RepoRole } from '@dotenvy/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitHubRepoInfo {
  id: number
  owner: string
  name: string
  private: boolean
  description: string | null
}

// ─── Permission mapping ───────────────────────────────────────────────────────

/**
 * Maps GitHub's raw collaborator permission string to the GitHubPermission enum.
 * GitHub returns: "none" | "read" | "triage" | "write" | "maintain" | "admin"
 */
export function mapRawPermission(raw: string): GitHubPermission {
  const map: Record<string, GitHubPermission> = {
    none: GitHubPermission.NONE,
    read: GitHubPermission.READ,
    triage: GitHubPermission.TRIAGE,
    write: GitHubPermission.WRITE,
    maintain: GitHubPermission.MAINTAIN,
    admin: GitHubPermission.ADMIN,
  }
  return map[raw.toLowerCase()] ?? GitHubPermission.NONE
}

/**
 * Maps the internal 3-tier role to the closest GitHub permission for storage.
 * READ → READ, WRITE → WRITE, ADMIN → ADMIN.
 * Used when persisting a user-facing role choice into Environment.minPermission.
 */
export function roleToPermission(role: RepoRole): GitHubPermission {
  switch (role) {
    case 'READ':
      return GitHubPermission.READ
    case 'WRITE':
      return GitHubPermission.WRITE
    case 'ADMIN':
      return GitHubPermission.ADMIN
  }
}

/**
 * Collapses GitHub's 6-level permission to the 3-tier internal role.
 * Returns null for NONE — the caller should treat this as no access.
 */
export function permissionToRole(permission: GitHubPermission): RepoRole | null {
  switch (permission) {
    case GitHubPermission.READ:
    case GitHubPermission.TRIAGE:
      return 'READ'
    case GitHubPermission.WRITE:
    case GitHubPermission.MAINTAIN:
      return 'WRITE'
    case GitHubPermission.ADMIN:
      return 'ADMIN'
    default:
      return null
  }
}

// ─── GitHub App authentication ────────────────────────────────────────────────

/**
 * Generates a GitHub App JWT signed with RS256 (valid 10 minutes).
 * Used as the bearer token when calling App-level API endpoints.
 * Returns null if GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY are not set.
 */
async function createAppJwt(): Promise<string | null> {
  const appId = process.env.GITHUB_APP_ID
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY
  if (!appId || !rawKey) return null

  try {
    // Env vars often store PEM with literal \n — normalise to real newlines
    const pem = rawKey.replace(/\\n/g, '\n')
    const privateKey = await importPKCS8(pem, 'RS256')
    const now = Math.floor(Date.now() / 1000)

    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt(now - 60) // 60 s backdate to tolerate clock drift
      .setIssuer(appId)
      .setExpirationTime(now + 600)
      .sign(privateKey)
  } catch {
    return null
  }
}

/**
 * Exchanges a GitHub App JWT for an installation access token scoped to the
 * repos under the given installation.
 *
 * Returns null when:
 *   - installationId ≤ 0 (placeholder for manually-connected repos)
 *   - App credentials are absent
 *   - The GitHub API call fails
 *
 * NOTE: Installation tokens expire after 1 hour. For production workloads,
 * cache them (e.g. in Redis) keyed by installationId with a TTL of 55 minutes.
 */
export async function getInstallationToken(installationId: number): Promise<string | null> {
  // Negative IDs are placeholders for manually-connected repos (no real App installation)
  if (installationId <= 0) return null

  const jwt = await createAppJwt()
  if (!jwt) return null

  try {
    const res = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { token: string }
    return data.token
  } catch {
    return null
  }
}

// ─── Repo-scoped API calls (require installation token) ──────────────────────

/**
 * Fetches a collaborator's permission level for a specific repo.
 * Uses the installation token (not a user OAuth token).
 *
 * Returns NONE on any error — callers should treat that as "no access".
 *
 * Endpoint: GET /repos/{owner}/{repo}/collaborators/{username}/permission
 */
export async function getCollaboratorPermission(
  installationToken: string,
  owner: string,
  name: string,
  login: string,
): Promise<GitHubPermission> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/collaborators/${login}/permission`,
      {
        headers: {
          Authorization: `Bearer ${installationToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )
    if (!res.ok) return GitHubPermission.NONE
    const data = (await res.json()) as { permission: string }
    return mapRawPermission(data.permission)
  } catch {
    return GitHubPermission.NONE
  }
}

// ─── Unauthenticated repo lookup ──────────────────────────────────────────────

/**
 * Fetches basic repo metadata from GitHub's public API (no auth required).
 * Works for public repos only. Returns null for private repos or on error.
 *
 * Used during the manual connect flow to resolve the numeric githubRepoId and
 * the private flag when the user doesn't provide them explicitly.
 *
 * Once GitHub App installation is the primary connect mechanism, this call is
 * replaced by the repository data in the installation webhook payload.
 */
export async function getRepoInfo(owner: string, name: string): Promise<GitHubRepoInfo | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      id: number
      owner: { login: string }
      name: string
      private: boolean
      description: string | null
    }
    return {
      id: data.id,
      owner: data.owner.login,
      name: data.name,
      private: data.private,
      description: data.description,
    }
  } catch {
    return null
  }
}
