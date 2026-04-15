/**
 * Project-level config — stored in .pullenv.json at the repo root.
 *
 * This file pins which Pullenv repo + environment the current project uses,
 * so the user doesn't have to pass --repo and --env on every pull.
 *
 * The file should be committed to source control (it contains no secrets).
 */

import fs from 'fs'
import path from 'path'

const CONFIG_FILE = '.pullenv.json'

export interface ProjectConfig {
  /** Pullenv repo ID (cuid), resolved at `pullenv init` time. */
  repoId: string
  /** Human-readable "owner/name" for display. */
  repoFullName: string
  /** Default environment name, e.g. "development". */
  defaultEnv: string
  /** Default output file for `pullenv pull`, e.g. ".env.local". */
  outputFile: string
}

/** Walks up the directory tree looking for .pullenv.json, returns null if none. */
export function findProjectConfig(): { config: ProjectConfig; configPath: string } | null {
  let dir = process.cwd()

  while (true) {
    const candidate = path.join(dir, CONFIG_FILE)
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, 'utf-8')
        return { config: JSON.parse(raw) as ProjectConfig, configPath: candidate }
      } catch {
        return null
      }
    }

    const parent = path.dirname(dir)
    if (parent === dir) break // reached filesystem root
    dir = parent
  }

  return null
}

/** Reads .pullenv.json in the current working directory (not walking up). */
export function readProjectConfig(): ProjectConfig | null {
  const configPath = path.join(process.cwd(), CONFIG_FILE)
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as ProjectConfig
  } catch {
    return null
  }
}

/** Writes .pullenv.json in the current working directory. */
export function writeProjectConfig(config: ProjectConfig): void {
  const configPath = path.join(process.cwd(), CONFIG_FILE)
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
}
