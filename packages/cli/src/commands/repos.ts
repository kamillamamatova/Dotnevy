import { listRepos } from '../api.js'
import { success, error, table, blank, header, fmt } from '../output.js'

export async function reposCommand(): Promise<void> {
  const repos = await listRepos()

  if (repos.length === 0) {
    blank()
    error('You are not a member of any repos in Pullenv.')
    return
  }

  header(`Repos (${repos.length})`)
  blank()
  table(
    repos.map((r) => ({
      repo: `${r.owner}/${r.name}`,
      role: r.role,
      id: r.id,
    })),
    [
      { key: 'repo', label: 'Repo' },
      { key: 'role', label: 'Role' },
      { key: 'id', label: 'ID' },
    ],
  )
  blank()
  success(`Run ${fmt.bold('pullenv envs --repo owner/name')} to see environments for a repo.`)
}
