'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ConnectRepoPage() {
  const router = useRouter()
  const [owner, setOwner] = useState('')
  const [name, setName] = useState('')
  const [githubRepoId, setGithubRepoId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const body: Record<string, unknown> = { owner: owner.trim(), name: name.trim() }
    if (githubRepoId.trim()) {
      const id = parseInt(githubRepoId.trim(), 10)
      if (isNaN(id) || id <= 0) {
        setError('GitHub repo ID must be a positive integer.')
        setLoading(false)
        return
      }
      body.githubRepoId = id
    }

    try {
      const res = await fetch('/api/repos/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Something went wrong.')
        return
      }

      router.push(`/repos/${data.id}`)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <div className="mb-8">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-800">
          ← Back to repos
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Connect a repo</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect a GitHub repository to start managing its environment variables with Dotenvy.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="owner" className="block text-sm font-medium text-gray-700">
              Owner
            </label>
            <input
              id="owner"
              type="text"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="acme-inc"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              Repository name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-app"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>
        </div>

        <div>
          <label htmlFor="repoId" className="block text-sm font-medium text-gray-700">
            GitHub repo ID{' '}
            <span className="font-normal text-gray-400">(optional — required for private repos)</span>
          </label>
          <input
            id="repoId"
            type="number"
            value={githubRepoId}
            onChange={(e) => setGithubRepoId(e.target.value)}
            placeholder="123456789"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
          <p className="mt-1 text-xs text-gray-400">
            Find it at{' '}
            <code className="rounded bg-gray-100 px-1 py-0.5">
              github.com/&lt;owner&gt;/&lt;repo&gt;
            </code>{' '}
            → Settings → General → Repo ID, or via the GitHub API.
          </p>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? 'Connecting…' : 'Connect repo'}
        </button>
      </form>

      <div className="mt-8 rounded-lg border border-blue-100 bg-blue-50 px-4 py-4 text-sm text-blue-800">
        <p className="font-medium">GitHub App installation coming soon</p>
        <p className="mt-1 text-blue-700">
          Installing the Dotenvy GitHub App on your org will automatically connect repos and sync
          collaborator permissions. For now, connect repos manually above.
        </p>
      </div>
    </main>
  )
}
