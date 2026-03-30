#!/usr/bin/env node
import { Command } from 'commander'
import { loginCommand } from './commands/login.js'
import { pullCommand } from './commands/pull.js'
import { whoamiCommand } from './commands/whoami.js'
import { clearCredentials } from './auth.js'

const program = new Command()

program
  .name('pullenv')
  .description('Pull shared environment variables for local development')
  .version('0.1.0')

program
  .command('login')
  .description('Authenticate with GitHub via Pullenv')
  .action(async () => {
    try {
      await loginCommand()
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('pull')
  .description('Pull env vars into a local .env file')
  .option('--env <name>', 'Env set name to pull', 'development')
  .option('--output <file>', 'Output file path', '.env.local')
  .option('--force', 'Overwrite output file if it already exists', false)
  .action(async (options) => {
    try {
      await pullCommand(options)
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('whoami')
  .description('Show current login status and token info')
  .action(() => {
    whoamiCommand()
  })

program
  .command('logout')
  .description('Remove stored credentials')
  .action(() => {
    clearCredentials()
    console.log('Logged out.')
  })

program.parse()
