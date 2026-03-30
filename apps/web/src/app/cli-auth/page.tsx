'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { signIn } from 'next-auth/react'

/**
 * Browser landing page for the CLI device flow.
 * After GitHub OAuth completes, this page posts the state token to the API
 * so the CLI can exchange it for a JWT.
 */
export default function CliAuthPage() {
  const { data: session, status } = useSession()
  const searchParams = useSearchParams()
  const state = searchParams.get('state')

  const [claimed, setClaimed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      signIn('github', { callbackUrl: `/cli-auth?state=${state}` })
    }
  }, [status, state])

  useEffect(() => {
    if (status !== 'authenticated' || !state || claimed) return

    fetch('/api/tokens/cli', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to claim state')
        setClaimed(true)
      })
      .catch((err) => setError((err as Error).message))
  }, [status, state, claimed])

  if (status === 'loading') return <p className="p-8">Loading...</p>
  if (error) return <p className="p-8 text-red-600">Error: {error}</p>

  if (claimed) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-semibold">Authentication successful</h1>
        <p className="text-gray-600">You can close this tab and return to the terminal.</p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <p className="text-gray-600">Completing authentication...</p>
    </main>
  )
}
