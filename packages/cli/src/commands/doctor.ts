import { execSync } from 'child_process'
import { readCredentials, isTokenExpired, DEFAULT_API_BASE, RefreshExpiredError } from '../auth.js'
import { findProjectConfig } from '../config.js'
import { success, error, warn, hint, blank, header, fmt } from '../output.js'

export async function doctorCommand(): Promise<void> {
  blank()
  header('pullenv doctor', 'Checking your setup')
  blank()

  let allGood = true

  // ── 1. Node version ────────────────────────────────────────────────────────
  const nodeVersion = process.version // "v20.x.x"
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10)
  if (major >= 20) {
    check('Node.js', `${nodeVersion} (ok)`)
  } else {
    fail('Node.js', `${nodeVersion} — requires >=20`)
    allGood = false
  }

  // ── 2. Git available ───────────────────────────────────────────────────────
  try {
    const gitVersion = execSync('git --version', { stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim()
    check('Git', gitVersion)
  } catch {
    fail('Git', 'not found — git must be installed and on PATH')
    allGood = false
  }

  // ── 3. Credentials ─────────────────────────────────────────────────────────
  const creds = readCredentials()
  if (!creds) {
    fail('Auth', `Not logged in — run ${fmt.bold('pullenv login')}`)
    allGood = false
  } else if (isTokenExpired(creds)) {
    notice('Auth', `Token expired — will auto-refresh on next command`)
  } else {
    const expiry = new Date(creds.expiresAt).toLocaleString()
    check('Auth', `Logged in, token valid until ${expiry}`)
  }

  // ── 4. API reachable ───────────────────────────────────────────────────────
  const apiBase = creds?.apiBase ?? DEFAULT_API_BASE
  try {
    const res = await fetch(`${apiBase}/api/health`, { signal: AbortSignal.timeout(5_000) })
    if (res.ok) {
      check('API', `${apiBase} reachable`)
    } else {
      fail('API', `${apiBase} responded with ${res.status}`)
      allGood = false
    }
  } catch {
    fail('API', `${apiBase} unreachable — check your network or PULLENV_API_BASE`)
    allGood = false
  }

  // ── 5. Project config ──────────────────────────────────────────────────────
  const project = findProjectConfig()
  if (project) {
    check(
      'Project config',
      `${project.configPath} → ${project.config.repoFullName} / ${project.config.defaultEnv}`,
    )
  } else {
    notice('Project config', `No .pullenv.json found — run ${fmt.bold('pullenv init')} to create one`)
  }

  // ── 6. Summary ─────────────────────────────────────────────────────────────
  blank()
  if (allGood) {
    success('All checks passed.')
  } else {
    error('Some checks failed. Fix the issues above and re-run pullenv doctor.')
    process.exit(1)
  }
}

function check(label: string, detail: string): void {
  console.log(`  ${fmt.green('✓')} ${fmt.bold(label.padEnd(16))} ${detail}`)
}

function fail(label: string, detail: string): void {
  console.log(`  ${fmt.red('✗')} ${fmt.bold(label.padEnd(16))} ${detail}`)
}

function notice(label: string, detail: string): void {
  console.log(`  ${fmt.yellow('⚠')} ${fmt.bold(label.padEnd(16))} ${detail}`)
}
