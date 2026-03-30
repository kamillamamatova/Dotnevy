import { readCredentials, isTokenExpired } from '../auth.js'

export function whoamiCommand(): void {
  const creds = readCredentials()

  if (!creds) {
    console.log('Not logged in.')
    process.exit(1)
  }

  // Decode JWT payload without verifying (display only)
  const [, payloadB64] = creds.accessToken.split('.')
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'))

  const expired = isTokenExpired(creds)
  const expiresAt = new Date(creds.expiresAt).toLocaleString()

  console.log(`Logged in as: ${payload.githubLogin}`)
  console.log(`Token expires: ${expiresAt}${expired ? ' (expired, will refresh)' : ''}`)
  console.log(`API:           ${creds.apiBase}`)
}
