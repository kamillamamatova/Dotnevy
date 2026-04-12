'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  repoId: string
  envId: string
  envName: string
}

export function DeleteEnvButton({ repoId, envId, envName }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    setLoading(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/environments/${envId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        router.push(`/repos/${repoId}`)
        router.refresh()
      }
    } finally {
      setLoading(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">Delete "{envName}"?</span>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? 'Deleting…' : 'Yes, delete'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:border-red-300 hover:text-red-600"
    >
      Delete environment
    </button>
  )
}
