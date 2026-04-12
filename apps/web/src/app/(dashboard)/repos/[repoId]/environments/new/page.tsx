'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

type Preset = {
  label: string
  name: string
  type: 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION' | 'CUSTOM'
  description: string
  defaultMinRole: 'READ' | 'WRITE' | 'ADMIN'
  color: string
}

const PRESETS: Preset[] = [
  {
    label: 'Development',
    name: 'development',
    type: 'DEVELOPMENT',
    description: 'Local development variables',
    defaultMinRole: 'READ',
    color: 'border-green-200 bg-green-50 text-green-800 hover:border-green-400',
  },
  {
    label: 'Staging',
    name: 'staging',
    type: 'STAGING',
    description: 'Pre-production / QA environment',
    defaultMinRole: 'READ',
    color: 'border-yellow-200 bg-yellow-50 text-yellow-800 hover:border-yellow-400',
  },
  {
    label: 'Production',
    name: 'production',
    type: 'PRODUCTION',
    description: 'Live production secrets — stricter access recommended',
    defaultMinRole: 'WRITE',
    color: 'border-red-200 bg-red-50 text-red-800 hover:border-red-400',
  },
  {
    label: 'Custom',
    name: '',
    type: 'CUSTOM',
    description: 'Define your own environment name',
    defaultMinRole: 'READ',
    color: 'border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-400',
  },
]

const MIN_ROLE_OPTIONS = [
  { value: 'READ', label: 'Read', detail: 'Any team member can pull secrets' },
  { value: 'WRITE', label: 'Write', detail: 'Contributors and above only' },
  { value: 'ADMIN', label: 'Admin', detail: 'Admins only' },
] as const

export default function NewEnvironmentPage() {
  const router = useRouter()
  const params = useParams<{ repoId: string }>()

  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<'DEVELOPMENT' | 'STAGING' | 'PRODUCTION' | 'CUSTOM'>('CUSTOM')
  const [minRole, setMinRole] = useState<'READ' | 'WRITE' | 'ADMIN'>('READ')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function applyPreset(preset: Preset) {
    setSelectedPreset(preset)
    setName(preset.name)
    setType(preset.type)
    setMinRole(preset.defaultMinRole)
    setDescription(preset.description)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch(`/api/repos/${params.repoId}/environments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, minRole, description: description.trim() || undefined }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Something went wrong.')
        return
      }

      router.push(`/repos/${params.repoId}/environments/${data.id}`)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-8">
        <Link
          href={`/repos/${params.repoId}`}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          ← Back to repo
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Add environment</h1>
        <p className="mt-1 text-sm text-gray-500">
          Environments group your variable templates by deployment context.
        </p>
      </div>

      {/* Preset cards */}
      <div className="mb-8">
        <p className="mb-3 text-sm font-medium text-gray-700">Choose a preset</p>
        <div className="grid grid-cols-2 gap-3">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`rounded-lg border-2 p-4 text-left transition-colors ${preset.color} ${
                selectedPreset?.label === preset.label ? 'ring-2 ring-gray-400 ring-offset-1' : ''
              }`}
            >
              <p className="font-medium">{preset.label}</p>
              <p className="mt-0.5 text-xs opacity-75">{preset.description}</p>
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Environment name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. production"
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
          <p className="mt-1 text-xs text-gray-400">
            Letters, digits, hyphens, and underscores only.
          </p>
        </div>

        <div>
          <p className="block text-sm font-medium text-gray-700">Minimum access to pull secrets</p>
          <div className="mt-2 space-y-2">
            {MIN_ROLE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 px-4 py-3 hover:bg-gray-50">
                <input
                  type="radio"
                  name="minRole"
                  value={opt.value}
                  checked={minRole === opt.value}
                  onChange={() => setMinRole(opt.value)}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                  <span className="ml-2 text-sm text-gray-500">{opt.detail}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">
            Description{' '}
            <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            id="description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description of this environment"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            {loading ? 'Creating…' : 'Create environment'}
          </button>
          <Link
            href={`/repos/${params.repoId}`}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Cancel
          </Link>
        </div>
      </form>
    </main>
  )
}
