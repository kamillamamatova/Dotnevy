import { readCredentials, isTokenExpired } from '../auth.js'
import { error, blank, hint, fmt } from '../output.js'

export function whoamiCommand(): void {
  const creds = readCredentials()

  if (!creds) {
    blank()
    error(`Not logged in.`)
    hint(`Run ${fmt.bold('dotenvy login')} to authenticate.`)
    blank()
    process.exit(1)
  }

  // Decode JWT payload without verifying (display only)
  const [, payloadB64] = creds.accessToken.split('.')
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
    githubLogin: string
  }

  const expired = isTokenExpired(creds)
  const expiresAt = new Date(creds.expiresAt).toLocaleString()

  blank()
  console.log(`  ${fmt.bold('User:')}     ${payload.githubLogin}`)
  console.log(
    `  ${fmt.bold('Token:')}    expires ${expiresAt}${expired ? fmt.yellow(' (expired, will auto-refresh)') : ''}`,
  )
  console.log(`  ${fmt.bold('API:')}      ${creds.apiBase}`)
  blank()
  hint(`Run ${fmt.bold('dotenvy repos')} to list your repos.`)
}
