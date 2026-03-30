import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { getValidToken } from '../auth.js'
import type { EnvVar } from '@pullenv/shared'

interface PullOptions {
  env: string
  output: string
  force: boolean
}

export async function pullCommand(options: PullOptions): Promise<void> {
  const { token, apiBase } = await getValidToken()

  // 1. Resolve the GitHub remote URL from the current directory
  const githubRemote = getGitRemote()
  if (!githubRemote) {
    throw new Error('Could not detect a GitHub remote. Are you inside a git repository?')
  }

  // 2. Look up the repo by remote URL
  const repoRes = await fetch(
    `${apiBase}/api/repos?githubRemote=${encodeURIComponent(githubRemote)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (repoRes.status === 404) {
    throw new Error(`Repo not found in Pullenv. An admin needs to register it first.`)
  }
  if (!repoRes.ok) {
    throw new Error(`Failed to resolve repo: ${repoRes.status}`)
  }

  const { id: repoId } = (await repoRes.json()) as { id: string }

  // 3. Fetch the decrypted env vars
  const varsRes = await fetch(
    `${apiBase}/api/repos/${repoId}/envsets/${options.env}/vars`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (varsRes.status === 403) {
    throw new Error(`You do not have permission to pull the "${options.env}" env set.`)
  }
  if (varsRes.status === 404) {
    throw new Error(`Env set "${options.env}" not found for this repo.`)
  }
  if (!varsRes.ok) {
    throw new Error(`Failed to fetch env vars: ${varsRes.status}`)
  }

  const vars = (await varsRes.json()) as EnvVar[]

  // 4. Write to output file
  const outputPath = path.resolve(options.output)

  if (fs.existsSync(outputPath) && !options.force) {
    throw new Error(
      `${options.output} already exists. Use --force to overwrite.`,
    )
  }

  const lines = vars.map(({ key, value }) => `${key}=${formatValue(value)}`)
  fs.writeFileSync(outputPath, lines.join('\n') + '\n', { mode: 0o600 })

  // 5. Ensure output file is in .gitignore
  ensureGitignored(options.output)

  console.log(
    `Wrote ${vars.length} variable${vars.length !== 1 ? 's' : ''} to ${options.output}`,
  )
}

function getGitRemote(): string | null {
  try {
    const url = execSync('git remote get-url origin', { stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim()
    return url
  } catch {
    return null
  }
}

/** Wraps values containing spaces or special characters in double quotes. */
function formatValue(value: string): string {
  if (/[\s"'#]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`
  }
  return value
}

function ensureGitignored(filename: string): void {
  const gitignorePath = path.resolve('.gitignore')

  try {
    const content = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf-8')
      : ''

    if (!content.split('\n').some((line) => line.trim() === filename)) {
      fs.appendFileSync(gitignorePath, `\n${filename}\n`)
      console.log(`Added ${filename} to .gitignore`)
    }
  } catch {
    // Non-fatal
  }
}
