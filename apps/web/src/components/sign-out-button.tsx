'use client'

import { signOut } from 'next-auth/react'

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/' })}
      className="rounded px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900"
    >
      Sign out
    </button>
  )
}
