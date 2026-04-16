'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { signIn } from 'next-auth/react'

type Status = 'loading' | 'redirecting' | 'claiming' | 'done' | 'error'

/**
 * Browser landing page for the CLI device flow.
 *
 * Flow:
 *  1. CLI opens this page with ?state=<uuid>
 *  2. If user is not logged in → redirect to GitHub OAuth (callbackUrl returns here)
 *  3. Once session is established → POST state to /api/tokens/cli to claim it
 *  4. CLI's polling loop picks up the claimed state and receives its JWT
 */
export default function CliAuthPage() {
  const { data: session, status: sessionStatus } = useSession()
  const searchParams = useSearchParams()
  const state = searchParams.get('state')

  const [status, setStatus] = useState<Status>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Step 1: redirect to GitHub OAuth if not logged in
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      if (!state) {
        setStatus('error')
        setErrorMessage('Missing state parameter. Please run dotenvy login again.')
        return
      }
      setStatus('redirecting')
      signIn('github', { callbackUrl: `/cli-auth?state=${state}` })
    }
  }, [sessionStatus, state])

  // Step 2: claim the state once the session is ready
  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !state || status === 'done' || status === 'error') {
      return
    }

    setStatus('claiming')

    fetch('/api/tokens/cli', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
      .then(async (res) => {
        if (res.ok) {
          setStatus('done')
          return
        }

        let reason = `Server error (${res.status})`
        try {
          const body = await res.json() as { error?: string }
          if (body.error) reason = body.error
        } catch { /* ignore */ }

        // 409 = already claimed (user may have opened the tab twice — harmless)
        if (res.status === 409) {
          setStatus('done')
          return
        }

        setStatus('error')
        setErrorMessage(reason)
      })
      .catch((err: unknown) => {
        setStatus('error')
        setErrorMessage(err instanceof Error ? err.message : 'Network error')
      })
  }, [sessionStatus, state, status])

  // ── Render ──────────────────────────────────────────────────────────────────

  if (status === 'error') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="rounded-full bg-red-100 p-4 text-2xl">✗</div>
        <h1 className="text-xl font-semibold text-gray-900">Authentication failed</h1>
        <p className="max-w-sm text-sm text-gray-500">{errorMessage}</p>
        <p className="text-sm text-gray-400">Run <code className="rounded bg-gray-100 px-1 py-0.5">dotenvy login</code> in your terminal to try again.</p>
      </main>
    )
  }

  if (status === 'done') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="rounded-full bg-green-100 p-4 text-2xl">✓</div>
        <h1 className="text-xl font-semibold text-gray-900">Authentication successful</h1>
        <p className="text-sm text-gray-500">
          Logged in as{' '}
          <span className="font-medium text-gray-700">
            {session?.user?.githubLogin ?? session?.user?.name ?? 'you'}
          </span>
        </p>
        <p className="mt-2 text-sm text-gray-400">You can close this tab and return to the terminal.</p>
      </main>
    )
  }

  const loadingMessage: Record<Status, string> = {
    loading: 'Loading…',
    redirecting: 'Redirecting to GitHub…',
    claiming: 'Completing authentication…',
    done: '',
    error: '',
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-gray-700" />
      <p className="text-sm text-gray-500">{loadingMessage[status]}</p>
    </main>
  )
}
