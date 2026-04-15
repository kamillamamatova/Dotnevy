import { listRepos, listEnvironments, ApiError } from '../api.js'
import { readProjectConfig, writeProjectConfig } from '../config.js'
import { success, warn, error, hint, blank, header, prompt, promptList, fmt } from '../output.js'

export async function initCommand(): Promise<void> {
  blank()
  header('pullenv init', 'Link this project to a Pullenv repo')
  blank()

  // ── Warn if already initialized ────────────────────────────────────────────
  const existing = readProjectConfig()
  if (existing) {
    warn(`.pullenv.json already exists (${existing.repoFullName} / ${existing.defaultEnv})`)
    const overwrite = await prompt('Overwrite? (y/N)', 'N')
    if (overwrite.toLowerCase() !== 'y') {
      hint('Aborted.')
      return
    }
    blank()
  }

  // ── 1. List repos the user can access ─────────────────────────────────────
  let repos
  try {
    repos = await listRepos()
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      error(`Not logged in. Run ${fmt.bold('pullenv login')} first.`)
    } else {
      error(`Failed to fetch repos: ${(err as Error).message}`)
    }
    process.exit(1)
  }

  if (repos.length === 0) {
    error('You are not a member of any repos in Pullenv.')
    hint('Ask a repo admin to add you, then run pullenv init again.')
    process.exit(1)
  }

  // ── 2. Pick a repo ────────────────────────────────────────────────────────
  console.log('Select a repo:')
  blank()
  const repoIndex = await promptList(
    'Repo',
    repos.map((r) => `${r.owner}/${r.name} ${fmt.dim(`[${r.role}]`)}`),
    0,
  )
  const selectedRepo = repos[repoIndex]
  blank()

  // ── 3. List environments for that repo ────────────────────────────────────
  let envs
  try {
    envs = await listEnvironments(selectedRepo.id)
  } catch (err) {
    error(`Failed to fetch environments: ${(err as Error).message}`)
    process.exit(1)
  }

  if (envs.length === 0) {
    error(`No environments found for ${selectedRepo.owner}/${selectedRepo.name}.`)
    process.exit(1)
  }

  // ── 4. Pick a default environment ─────────────────────────────────────────
  console.log('Select the default environment for this project:')
  blank()
  const defaultEnvIndex = findDefaultEnvIndex(envs.map((e) => e.name))
  const envIndex = await promptList(
    'Environment',
    envs.map((e) => `${e.name} ${fmt.dim(`[${e.type}]`)}`),
    defaultEnvIndex,
  )
  const selectedEnv = envs[envIndex]
  blank()

  // ── 5. Pick an output file ─────────────────────────────────────────────────
  const outputFile = await prompt('Output file', '.env.local')
  blank()

  // ── 6. Write config ────────────────────────────────────────────────────────
  writeProjectConfig({
    repoId: selectedRepo.id,
    repoFullName: `${selectedRepo.owner}/${selectedRepo.name}`,
    defaultEnv: selectedEnv.name,
    outputFile,
  })

  success(`Created .pullenv.json`)
  hint(`Repo:        ${selectedRepo.owner}/${selectedRepo.name}`)
  hint(`Environment: ${selectedEnv.name}`)
  hint(`Output file: ${outputFile}`)
  blank()
  hint(`Commit .pullenv.json to share this config with your team.`)
  hint(`Run ${fmt.bold('pullenv pull')} to pull variables now.`)
}

/** Returns the index of the first 'development' or 'dev' env, or 0. */
function findDefaultEnvIndex(names: string[]): number {
  const dev = names.findIndex((n) =>
    n.toLowerCase() === 'development' || n.toLowerCase() === 'dev',
  )
  return dev >= 0 ? dev : 0
}
