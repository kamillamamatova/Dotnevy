import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { SignOutButton } from '@/components/sign-out-button'

/**
 * Shared layout for all /dashboard routes.
 * Performs a server-side session check as a defense-in-depth measure on top of
 * the middleware guard in middleware.ts.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <span className="font-semibold tracking-tight text-gray-900">Dotenvy</span>

          {/* Signed-in identity strip */}
          <div className="flex items-center gap-3">
            {session.user.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt={session.user.githubLogin}
                width={28}
                height={28}
                className="rounded-full"
              />
            )}
            <span className="text-sm text-gray-700">
              Signed in as{' '}
              <a
                href={`https://github.com/${session.user.githubLogin}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-gray-900 hover:underline"
              >
                @{session.user.githubLogin}
              </a>
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="flex-1">{children}</div>
    </div>
  )
}
