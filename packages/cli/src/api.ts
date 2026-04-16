/**
 * Typed API client for the Dotenvy web app.
 *
 * All network calls go through `apiGet` / `apiPost` so auth headers and error
 * handling are applied consistently. The base URL is always read from the
 * stored credentials, never hardcoded here.
 */

import { getValidToken } from './auth.js'
import type { PullEnvResponse } from '@dotenvy/shared'

// ─── Generic request helpers ──────────────────────────────────────────────────

async function apiGet<T>(path: string): Promise<T> {
  const { token, apiBase } = await getValidToken()
  const res = await fetch(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return handleResponse<T>(res)
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>

  let message = `HTTP ${res.status}`
  try {
    const body = (await res.json()) as { error?: string; reason?: string }
    message = body.reason ?? body.error ?? message
  } catch {
    // Body wasn't JSON — keep the status-only message
  }

  const err = new ApiError(message, res.status)
  throw err
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ─── Repos ────────────────────────────────────────────────────────────────────

export interface RepoSummary {
  id: string
  owner: string
  name: string
  role: string
}

/** Lists all repos the authenticated user has access to. */
export async function listRepos(): Promise<RepoSummary[]> {
  return apiGet<RepoSummary[]>('/api/repos')
}

/** Resolves a repo by its "owner/name" slug. Returns null if not found. */
export async function getRepoBySlug(slug: string): Promise<RepoSummary | null> {
  const [owner, name] = slug.split('/')
  if (!owner || !name) return null

  try {
    return await apiGet<RepoSummary>(`/api/repos/by-slug/${owner}/${name}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

// ─── Environments ─────────────────────────────────────────────────────────────

export interface EnvironmentSummary {
  id: string
  name: string
  type: string
  minPermission: string
}

/** Lists environments for a repo. */
export async function listEnvironments(repoId: string): Promise<EnvironmentSummary[]> {
  return apiGet<EnvironmentSummary[]>(`/api/repos/${repoId}/environments`)
}

/** Finds a single environment by name within a repo. Returns null if not found. */
export async function getEnvironmentByName(
  repoId: string,
  name: string,
): Promise<EnvironmentSummary | null> {
  const envs = await listEnvironments(repoId)
  return envs.find((e) => e.name.toLowerCase() === name.toLowerCase()) ?? null
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

/** Pulls decrypted variables for an environment. */
export async function pullEnvironment(
  repoId: string,
  envId: string,
): Promise<PullEnvResponse> {
  return apiGet<PullEnvResponse>(`/api/repos/${repoId}/environments/${envId}/pull`)
}
