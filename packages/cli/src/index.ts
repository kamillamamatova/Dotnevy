#!/usr/bin/env node
import { Command } from 'commander'
import { loginCommand } from './commands/login.js'
import { pullCommand } from './commands/pull.js'
import { whoamiCommand } from './commands/whoami.js'
import { reposCommand } from './commands/repos.js'
import { envsCommand } from './commands/envs.js'
import { doctorCommand } from './commands/doctor.js'
import { initCommand } from './commands/init.js'
import { clearCredentials, NotLoggedInError, RefreshExpiredError } from './auth.js'
import { success, error, hint, blank, fmt } from './output.js'

const program = new Command()

program
  .name('pullenv')
  .description('Pull shared environment variables for local development')
  .version('0.1.0')

// ─── Auth ─────────────────────────────────────────────────────────────────────

program
  .command('login')
  .description('Authenticate with GitHub via Pullenv')
  .action(run(loginCommand))

program
  .command('logout')
  .description('Remove stored credentials and revoke the server-side session')
  .action(
    run(async () => {
      await clearCredentials(true)
      blank()
      success('Logged out.')
      blank()
    }),
  )

program
  .command('whoami')
  .description('Show current login status and token info')
  .action(() => whoamiCommand())

// ─── Discovery ────────────────────────────────────────────────────────────────

program
  .command('repos')
  .description('List repos you have access to')
  .action(run(reposCommand))

program
  .command('envs')
  .description('List environments for a repo')
  .requiredOption('--repo <owner/name>', 'Repository slug (e.g. acme/api)')
  .action(run((opts: { repo: string }) => envsCommand(opts)))

// ─── Pull ─────────────────────────────────────────────────────────────────────

program
  .command('pull')
  .description('Pull decrypted variables into a local .env file')
  .option('--repo <owner/name>', 'Repository slug (overrides .pullenv.json)')
  .option('--env <name>', 'Environment name (overrides .pullenv.json)')
  .option('--output <file>', 'Output file path (overrides .pullenv.json)', undefined)
  .option('--force', 'Merge and apply server changes (preserves local-only vars)', false)
  .option('--dry-run', 'Preview what would change without writing any files', false)
  .option('--check', 'Exit 0 if the local file is up to date, 1 if out of sync (CI-friendly)', false)
  .action(
    run(
      (opts: {
        repo?: string
        env?: string
        output?: string
        force: boolean
        dryRun: boolean
        check: boolean
      }) => pullCommand(opts),
    ),
  )

// ─── Setup ────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Create a .pullenv.json config for this project')
  .action(run(initCommand))

program
  .command('doctor')
  .description('Check your environment and auth setup')
  .action(run(doctorCommand))

program.parse()

// ─── Error wrapper ────────────────────────────────────────────────────────────

function run<T extends unknown[]>(fn: (...args: T) => Promise<void>) {
  return async (...args: T) => {
    try {
      await fn(...args)
    } catch (err) {
      if (err instanceof NotLoggedInError || err instanceof RefreshExpiredError) {
        blank()
        error(err.message)
        hint(`Run ${fmt.bold('pullenv login')} to authenticate.`)
        blank()
      } else {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`\n${fmt.red('✗')} ${message}\n`)
      }
      process.exit(1)
    }
  }
}
