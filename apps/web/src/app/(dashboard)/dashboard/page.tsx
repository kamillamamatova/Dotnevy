import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your Repos</h1>
        <span className="text-sm text-gray-500">@{session.user?.name}</span>
      </div>
      {/* Repo list will be populated in Phase 3 */}
      <p className="text-gray-500">No repos registered yet.</p>
    </main>
  )
}
