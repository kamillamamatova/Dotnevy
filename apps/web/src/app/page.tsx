import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">Pullenv</h1>
      <p className="max-w-md text-center text-gray-600">
        Secure shared environment variables for GitHub teams.
      </p>
      <Link
        href="/login"
        className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
      >
        Sign in with GitHub
      </Link>
    </main>
  )
}
