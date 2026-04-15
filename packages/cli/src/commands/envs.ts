import { getRepoBySlug, listEnvironments } from '../api.js'
import { error, table, blank, header, fmt } from '../output.js'

interface EnvsOptions {
  repo: string
}

export async function envsCommand(options: EnvsOptions): Promise<void> {
  const repo = await getRepoBySlug(options.repo)
  if (!repo) {
    error(`Repo "${options.repo}" not found in Pullenv.`)
    process.exit(1)
  }

  const envs = await listEnvironments(repo.id)

  if (envs.length === 0) {
    blank()
    error(`No environments found for ${options.repo}.`)
    return
  }

  header(`Environments — ${repo.owner}/${repo.name}`)
  blank()
  table(
    envs.map((e) => ({
      name: e.name,
      type: e.type,
      minRole: e.minPermission,
      id: e.id,
    })),
    [
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'minRole', label: 'Min Role' },
      { key: 'id', label: 'ID' },
    ],
  )
  blank()
  console.log(
    fmt.dim(
      `Run ${fmt.bold(`pullenv pull --repo ${options.repo} --env <name>`)} to pull variables.`,
    ),
  )
}
