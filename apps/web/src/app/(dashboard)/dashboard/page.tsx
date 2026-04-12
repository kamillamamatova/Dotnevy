import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  // Session is guaranteed by the (dashboard)/layout.tsx + middleware; null-guard is defensive.
  if (!session) return null

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Your Repos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Repos you&apos;ve connected via the GitHub App installation.
        </p>
      </div>

      {/* Repo list populated in Phase 3 once GitHub App installation flow is wired up. */}
      <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center">
        <p className="text-sm text-gray-500">No repos connected yet.</p>
        <p className="mt-1 text-xs text-gray-400">
          Install the Pullenv GitHub App on your org or personal account to get started.
        </p>
      </div>
    </main>
  )
}
