'use client'

import { SessionProvider } from 'next-auth/react'

/**
 * Wraps the app with NextAuth's SessionProvider so client components can call
 * useSession(). Server components use getServerSession(authOptions) directly.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}
