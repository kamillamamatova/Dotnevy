import fs from 'fs'
import path from 'path'
import { getRepoBySlug, getEnvironmentByName, pullEnvironment, ApiError } from '../api.js'
import { findProjectConfig } from '../config.js'
import { success, warn, error, hint, blank, header, spinner, fmt } from '../output.js'
import type { PullEnvResponse, PullVariable, SkippedVariable } from '@pullenv/shared'

interface PullOptions {
  repo?: string
  env?: string
  output?: string
  force: boolean
  dryRun: boolean
  check: boolean
}

export async function pullCommand(options: PullOptions): Promise<void> {
  // ── 1. Resolve repo + env from options or project config ───────────────────
  let repoSlug = options.repo
  let envName = options.env
  let outputFile = options.output ?? '.env.local'

  if (!repoSlug || !envName) {
    const found = findProjectConfig()
    if (found) {
      repoSlug ??= found.config.repoFullName
      envName ??= found.config.defaultEnv
      outputFile = options.output ?? found.config.outputFile
    }
  }

  if (!repoSlug) {
    error('No repo specified. Pass --repo owner/name or run pullenv init first.')
    process.exit(1)
  }
  if (!envName) {
    error('No environment specified. Pass --env <name> or run pullenv init first.')
    process.exit(1)
  }

  // ── 2. Resolve IDs ─────────────────────────────────────────────────────────
  const spin = spinner(`Resolving ${fmt.bold(repoSlug)}`)
  const { repoId, envId } = await resolveIds(spin, repoSlug, envName)

  // ── 3. Fetch from server ───────────────────────────────────────────────────
  spin.update(`Fetching ${fmt.bold(envName)} variables`)
  let data: PullEnvResponse
  try {
    data = await pullEnvironment(repoId, envId)
  } catch (e) {
    spin.stop()
    if (e instanceof ApiError) {
      if (e.status === 403) {
        error(`Access denied to "${envName}": ${e.message}`)
        hint('Ask a repo admin to grant you access to this environment.')
      } else if (e.status === 404) {
        error(`Environment "${envName}" not found.`)
      } else {
        error(`Pull failed: ${e.message}`)
      }
      process.exit(1)
    }
    throw e
  }

  spin.stop()

  const { variables, skipped, meta } = data
  const outputPath = path.resolve(outputFile)

  // Read the existing file now — used by dry-run, check, merge, and conflict preview
  const existingContent = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, 'utf-8')
    : null
  const existingVars = existingContent !== null ? parseEnvFile(existingContent) : null

  // ── 4. Dry-run ─────────────────────────────────────────────────────────────
  if (options.dryRun) {
    printDryRun(meta, outputFile, variables, skipped, existingVars)
    return
  }

  // ── 5. Check mode ──────────────────────────────────────────────────────────
  if (options.check) {
    const inSync = runCheck(meta, outputFile, variables, skipped, existingVars)
    process.exit(inSync ? 0 : 1)
  }

  // ── 6. Overwrite safety ────────────────────────────────────────────────────
  // File exists but --force not passed → show a preview of what would change, then stop.
  // This is much more helpful than a bare "file exists" error.
  if (existingContent !== null && !options.force) {
    printConflictPreview(outputFile, variables, existingVars!)
    process.exit(1)
  }

  // ── 7. Write (create or merge) ─────────────────────────────────────────────
  // When --force and the file exists, we merge:
  //   - Server values win for keys they define
  //   - Local-only keys (not in the server schema) are preserved at the bottom
  //   - This protects one-off local overrides the user added manually
  const { content, stats } = buildEnvFile(meta, variables, existingVars ?? new Map())
  fs.writeFileSync(outputPath, content, { mode: 0o600 })

  // ── 8. Ensure .gitignore ───────────────────────────────────────────────────
  const wasAdded = ensureGitignored(outputFile)

  // ── 9. Summary ─────────────────────────────────────────────────────────────
  blank()
  header(`${meta.repoFullName} / ${meta.environment}`, outputFile)
  blank()
  printVariableList(variables, skipped, existingVars)
  blank()

  if (existingVars !== null) {
    const parts: string[] = []
    if (stats.added > 0) parts.push(`${stats.added} added`)
    if (stats.updated > 0) parts.push(`${stats.updated} updated`)
    if (stats.unchanged > 0) parts.push(`${stats.unchanged} unchanged`)
    if (stats.localOnly > 0) parts.push(fmt.dim(`${stats.localOnly} local-only preserved`))
    success(`Updated ${fmt.bold(outputFile)} — ${parts.join(', ')}`)
  } else {
    success(`Wrote ${meta.variableCount} variable${meta.variableCount !== 1 ? 's' : ''} to ${fmt.bold(outputFile)}`)
  }

  if (wasAdded) hint(`Added ${outputFile} to .gitignore`)

  // ── 10. Non-zero exit when required vars are missing ──────────────────────
  // The file IS written (partial variables are better than none for local dev),
  // but we signal to CI that the environment is incomplete.
  const missingRequired = skipped.filter((s) => s.isRequired)
  if (missingRequired.length > 0) {
    blank()
    warn(
      `${missingRequired.length} required variable${missingRequired.length !== 1 ? 's' : ''} have no value set:`,
    )
    missingRequired.forEach((s) => hint(`  ${fmt.red('✗')} ${s.key}`))
    hint('Set these values in the Pullenv web UI, then run pullenv pull again.')
    process.exitCode = 1
  }
}

// ─── Env file parser ──────────────────────────────────────────────────────────

/**
 * Parses a .env file into a key→value map.
 * Handles unquoted, double-quoted, and single-quoted values.
 * Strips `export ` prefixes. Ignores comments and blank lines.
 * Does NOT expand variable references — values are stored literally.
 */
export function parseEnvFile(content: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const stripped = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = stripped.indexOf('=')
    if (eq === -1) continue
    const key = stripped.slice(0, eq).trim()
    if (!key) continue
    result.set(key, parseEnvValue(stripped.slice(eq + 1)))
  }
  return result
}

function parseEnvValue(raw: string): string {
  const s = raw.trim()
  // Double-quoted: respect escape sequences
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
  }
  // Single-quoted: literal (no escape processing)
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1)
  }
  return s
}

// ─── Env file writer ──────────────────────────────────────────────────────────

/**
 * Formats a value for writing into a .env file.
 *
 * Rules:
 *   - Empty string → bare `KEY=` (no quotes)
 *   - Values needing quoting → double-quoted with escape sequences
 *   - Newlines inside values → `\n` (dotenv convention for multiline secrets like PEM keys)
 *   - Plain alphanumeric/safe values → bare (most readable)
 *
 * Safe characters (no quoting needed): letters, digits, _, -, ., /, @, :
 */
export function formatValue(value: string): string {
  if (value === '') return ''
  // Characters that require double-quoting
  if (/[\s"'#$`\\=\n\r\t]/.test(value) || value.startsWith('!')) {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
    return `"${escaped}"`
  }
  return value
}

interface WriteStats {
  added: number
  updated: number
  unchanged: number
  localOnly: number
}

/**
 * Builds the full .env.local content.
 *
 * Layout:
 *   1. Header comment block
 *   2. Server-managed variables (alphabetical, with optional description comments)
 *   3. Local-only section (keys present in the existing file but not in the server schema)
 *
 * The local-only section lets users keep hand-added overrides (e.g., LOCAL_DB_URL)
 * without them being erased on every pull.
 */
function buildEnvFile(
  meta: PullEnvResponse['meta'],
  variables: PullVariable[],
  existingVars: Map<string, string>,
): { content: string; stats: WriteStats } {
  const stats: WriteStats = { added: 0, updated: 0, unchanged: 0, localOnly: 0 }
  const serverKeys = new Set(variables.map((v) => v.key))
  const localOnlyEntries = [...existingVars.entries()].filter(([k]) => !serverKeys.has(k))

  const lines: string[] = [
    `# Generated by pullenv — ${meta.repoFullName} / ${meta.environment}`,
    `# Pulled at: ${meta.pulledAt}`,
    `# DO NOT COMMIT this file.`,
    '',
  ]

  for (const v of variables) {
    if (v.description) lines.push(`# ${v.description}`)
    lines.push(`${v.key}=${formatValue(v.value)}`)

    if (!existingVars.size) {
      // Fresh create — all are "added"
      stats.added++
    } else if (!existingVars.has(v.key)) {
      stats.added++
    } else if (existingVars.get(v.key) === v.value) {
      stats.unchanged++
    } else {
      stats.updated++
    }
  }

  if (localOnlyEntries.length > 0) {
    lines.push('')
    lines.push('# ─── Local only (not managed by Pullenv) ────────────────────────────────────')
    for (const [key, value] of localOnlyEntries) {
      lines.push(`${key}=${formatValue(value)}`)
      stats.localOnly++
    }
  }

  return { content: lines.join('\n') + '\n', stats }
}

// ─── Output helpers ───────────────────────────────────────────────────────────

/**
 * Prints the variable list with change tags.
 * Used in both the normal write summary and dry-run output.
 */
function printVariableList(
  variables: PullVariable[],
  skipped: SkippedVariable[],
  existingVars: Map<string, string> | null,
): void {
  for (const v of variables) {
    const source = v.version === null ? fmt.dim('(default)') : fmt.dim(`v${v.version}`)
    const tag = existingVars
      ? changeTag(v.key, v.value, existingVars)
      : fmt.dim('new')
    const req = !v.isRequired ? fmt.dim(' optional') : ''
    console.log(`  ${fmt.green('✓')} ${fmt.bold(v.key)} ${tag} ${source}${req}`)
  }

  if (skipped.length > 0) {
    blank()
    for (const s of skipped) {
      const reqLabel = s.isRequired ? fmt.red('required') : fmt.dim('optional')
      console.log(`  ${fmt.yellow('–')} ${fmt.dim(s.key)} ${fmt.dim(`no value set (${reqLabel})`)}`)
    }
  }
}

function changeTag(key: string, value: string, existingVars: Map<string, string>): string {
  if (!existingVars.has(key)) return fmt.green('+new')
  if (existingVars.get(key) === value) return fmt.dim('=')
  return fmt.yellow('~updated')
}

/**
 * Dry-run output: shows what would be written without touching the disk.
 */
function printDryRun(
  meta: PullEnvResponse['meta'],
  outputFile: string,
  variables: PullVariable[],
  skipped: SkippedVariable[],
  existingVars: Map<string, string> | null,
): void {
  blank()
  header(`Dry run — ${meta.repoFullName} / ${meta.environment}`, outputFile)
  blank()
  printVariableList(variables, skipped, existingVars)
  blank()

  if (existingVars !== null) {
    // Show a brief merge preview
    const added = variables.filter((v) => !existingVars.has(v.key)).length
    const updated = variables.filter(
      (v) => existingVars.has(v.key) && existingVars.get(v.key) !== v.value,
    ).length
    const unchanged = variables.length - added - updated
    const localOnly = [...existingVars.keys()].filter(
      (k) => !variables.some((v) => v.key === k),
    ).length

    const parts = [
      added > 0 ? fmt.green(`${added} would add`) : '',
      updated > 0 ? fmt.yellow(`${updated} would update`) : '',
      unchanged > 0 ? fmt.dim(`${unchanged} unchanged`) : '',
      localOnly > 0 ? fmt.dim(`${localOnly} local-only preserved`) : '',
    ].filter(Boolean)

    hint(parts.join(', '))
    hint(`Would update ${fmt.bold(outputFile)} (--dry-run, no changes written)`)
  } else {
    hint(`Would create ${fmt.bold(outputFile)} (--dry-run, no changes written)`)
  }

  const missingRequired = skipped.filter((s) => s.isRequired)
  if (missingRequired.length > 0) {
    blank()
    warn(`${missingRequired.length} required variable${missingRequired.length !== 1 ? 's' : ''} have no value set.`)
    missingRequired.forEach((s) => hint(`  ${fmt.red('✗')} ${s.key}`))
  }
}

/**
 * Check mode: compares the existing file to the server state.
 * Suitable for CI — exits 0 if in sync, 1 if out of sync.
 */
function runCheck(
  meta: PullEnvResponse['meta'],
  outputFile: string,
  variables: PullVariable[],
  skipped: SkippedVariable[],
  existingVars: Map<string, string> | null,
): boolean {
  blank()
  header(`Check — ${meta.repoFullName} / ${meta.environment}`, outputFile)
  blank()

  if (existingVars === null) {
    error(`${outputFile} does not exist.`)
    hint(`Run ${fmt.bold('pullenv pull')} to create it.`)
    return false
  }

  const missing: string[] = []
  const stale: string[] = []

  for (const v of variables) {
    if (!existingVars.has(v.key)) {
      missing.push(v.key)
    } else if (existingVars.get(v.key) !== v.value) {
      stale.push(v.key)
    }
  }

  if (missing.length === 0 && stale.length === 0) {
    success(`${fmt.bold(outputFile)} is up to date.`)
    if (skipped.length > 0) {
      blank()
      hint(`${skipped.length} variable${skipped.length !== 1 ? 's' : ''} have no value set (skipped on server).`)
    }
    return true
  }

  if (missing.length > 0) {
    warn(`${missing.length} variable${missing.length !== 1 ? 's' : ''} missing from ${outputFile}:`)
    missing.forEach((k) => hint(`  ${fmt.red('missing')} ${k}`))
  }
  if (stale.length > 0) {
    if (missing.length > 0) blank()
    warn(`${stale.length} variable${stale.length !== 1 ? 's' : ''} have changed on the server:`)
    stale.forEach((k) => hint(`  ${fmt.yellow('stale')}   ${k}`))
  }

  blank()
  hint(`Run ${fmt.bold('pullenv pull --force')} to update.`)
  return false
}

/**
 * Shows a compact diff preview when the file exists and --force was not passed.
 * Guides the user toward the right next command rather than just erroring.
 */
function printConflictPreview(
  outputFile: string,
  variables: PullVariable[],
  existingVars: Map<string, string>,
): void {
  const added = variables.filter((v) => !existingVars.has(v.key))
  const updated = variables.filter(
    (v) => existingVars.has(v.key) && existingVars.get(v.key) !== v.value,
  )
  const unchanged = variables.filter(
    (v) => existingVars.has(v.key) && existingVars.get(v.key) === v.value,
  )

  blank()

  if (added.length > 0) {
    for (const v of added) console.log(`  ${fmt.green('+')} ${v.key}`)
  }
  if (updated.length > 0) {
    for (const v of updated) console.log(`  ${fmt.yellow('~')} ${v.key}  ${fmt.dim('(changed)')}`)
  }
  if (unchanged.length > 0 && (added.length > 0 || updated.length > 0)) {
    console.log(`  ${fmt.dim(`= ${unchanged.length} variable${unchanged.length !== 1 ? 's' : ''} unchanged`)}`)
  }

  blank()

  const parts: string[] = []
  if (added.length > 0) parts.push(fmt.green(`${added.length} new`))
  if (updated.length > 0) parts.push(fmt.yellow(`${updated.length} changed`))
  if (added.length === 0 && updated.length === 0) parts.push(fmt.dim('all variables unchanged'))

  warn(`${fmt.bold(outputFile)} already exists — ${parts.join(', ')}`)
  hint(`  ${fmt.bold('pullenv pull --force')}     apply changes (merge, preserves local-only vars)`)
  hint(`  ${fmt.bold('pullenv pull --dry-run')}   preview without writing`)
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

async function resolveIds(
  spin: ReturnType<typeof spinner>,
  repoSlug: string,
  envName: string,
): Promise<{ repoId: string; envId: string }> {
  try {
    const repo = await getRepoBySlug(repoSlug)
    if (!repo) {
      spin.stop()
      error(`Repo "${repoSlug}" not found in Pullenv. An admin needs to register it first.`)
      process.exit(1)
    }

    const env = await getEnvironmentByName(repo.id, envName)
    if (!env) {
      spin.stop()
      error(`Environment "${envName}" not found for ${repoSlug}.`)
      hint(`Run ${fmt.bold('pullenv envs --repo ' + repoSlug)} to see available environments.`)
      process.exit(1)
    }

    return { repoId: repo.id, envId: env.id }
  } catch (e) {
    spin.stop()
    throw e
  }
}

/**
 * Ensures filename is in .gitignore.
 * Returns true if a new entry was appended.
 */
function ensureGitignored(filename: string): boolean {
  const gitignorePath = path.resolve('.gitignore')
  try {
    const existing = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf-8')
      : ''
    if (existing.split('\n').map((l) => l.trim()).includes(filename)) return false
    fs.appendFileSync(gitignorePath, `\n${filename}\n`)
    return true
  } catch {
    return false
  }
}
