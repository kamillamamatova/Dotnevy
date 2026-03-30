'use client'

import { signIn } from 'next-auth/react'

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Sign in to Pullenv</h1>
      <button
        onClick={() => signIn('github', { callbackUrl: '/dashboard' })}
        className="flex items-center gap-2 rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
      >
        Continue with GitHub
      </button>
    </main>
  )
}
