'use client'

import { useState } from 'react'
import type { RepoRole } from '@pullenv/shared'

// ─── Data types (passed from server) ──────────────────────────────────────────

export interface AccessMember {
  membershipId: string
  userId: string
  githubLogin: string | null
  name: string | null
  image: string | null
  permission: string
  role: RepoRole | null
  syncedAt: string
}

export interface AccessEnvironment {
  id: string
  name: string
  type: string
  minRole: RepoRole
  description: string | null
}

export interface PolicyOverride {
  id: string
  userId: string
  githubLogin: string | null
  userImage: string | null
  environmentId: string | null
  action: 'PULL' | 'WRITE'
  effect: 'ALLOW' | 'DENY'
  createdAt: string
}

interface Props {
  repoId: string
  members: AccessMember[]
  environments: AccessEnvironment[]
  policies: PolicyOverride[]
  isAdmin: boolean
}

// ─── Root component ───────────────────────────────────────────────────────────

type Tab = 'environments' | 'overrides'

export function AccessPanel({ repoId, members, environments, policies, isAdmin }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('environments')

  return (
    <div>
      {/* Tab bar */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {([
            { id: 'environments' as Tab, label: 'Environment Access' },
            { id: 'overrides' as Tab, label: `Overrides`, count: policies.length },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {'count' in tab && tab.count > 0 && (
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {activeTab === 'environments' && (
          <EnvironmentAccessTab
            repoId={repoId}
            environments={environments}
            members={members}
            policies={policies}
            isAdmin={isAdmin}
          />
        )}
        {activeTab === 'overrides' && (
          <OverridesTab
            repoId={repoId}
            members={members}
            environments={environments}
            policies={policies}
            isAdmin={isAdmin}
          />
        )}
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<RepoRole, string> = {
  READ: 'bg-gray-100 text-gray-600',
  WRITE: 'bg-blue-50 text-blue-700',
  ADMIN: 'bg-purple-50 text-purple-700',
}

const MIN_ROLE_LABELS: Record<RepoRole, { label: string; description: string }> = {
  READ: { label: 'Any member', description: 'All repo members can pull' },
  WRITE: { label: 'Contributors+', description: 'WRITE or ADMIN role required' },
  ADMIN: { label: 'Admins only', description: 'ADMIN role required' },
}

const ENV_TYPE_STYLES: Record<string, { label: string; color: string }> = {
  DEVELOPMENT: { label: 'Dev', color: 'bg-green-100 text-green-800' },
  STAGING: { label: 'Staging', color: 'bg-yellow-100 text-yellow-800' },
  PRODUCTION: { label: 'Production', color: 'bg-red-100 text-red-800' },
  CUSTOM: { label: 'Custom', color: 'bg-gray-100 text-gray-700' },
}

const EFFECT_STYLES: Record<string, string> = {
  ALLOW: 'bg-green-50 text-green-700',
  DENY: 'bg-red-50 text-red-700',
}

// ─── Environment Access tab ───────────────────────────────────────────────────

function EnvironmentAccessTab({
  repoId,
  environments,
  members,
  policies,
  isAdmin,
}: {
  repoId: string
  environments: AccessEnvironment[]
  members: AccessMember[]
  policies: PolicyOverride[]
  isAdmin: boolean
}) {
  if (environments.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No environments configured. Create environments first.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {environments.map((env) => (
        <EnvironmentCard
          key={env.id}
          repoId={repoId}
          env={env}
          members={members}
          policies={policies}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  )
}

function EnvironmentCard({
  repoId,
  env,
  members,
  policies,
  isAdmin,
}: {
  repoId: string
  env: AccessEnvironment
  members: AccessMember[]
  policies: PolicyOverride[]
  isAdmin: boolean
}) {
  const [minRole, setMinRole] = useState<RepoRole>(env.minRole)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const typeInfo = ENV_TYPE_STYLES[env.type] ?? ENV_TYPE_STYLES.CUSTOM
  const minRoleInfo = MIN_ROLE_LABELS[minRole]
  const envPolicies = policies.filter((p) => p.environmentId === env.id)

  async function saveMinRole() {
    if (minRole === env.minRole) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/repos/${repoId}/environments/${env.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minRole }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.message ?? data.error ?? 'Failed to save')
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${typeInfo.color}`}>
            {typeInfo.label}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{env.name}</h3>
            {env.description && (
              <p className="text-xs text-gray-400">{env.description}</p>
            )}
          </div>
        </div>

        {/* minRole control */}
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <>
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Pull access
                </label>
                <select
                  value={minRole}
                  onChange={(e) => setMinRole(e.target.value as RepoRole)}
                  className="mt-0.5 rounded border border-gray-200 px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
                >
                  <option value="READ">Any member</option>
                  <option value="WRITE">Contributors+</option>
                  <option value="ADMIN">Admins only</option>
                </select>
              </div>
              {minRole !== env.minRole && (
                <button
                  onClick={saveMinRole}
                  disabled={saving}
                  className="mt-4 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              )}
              {saved && (
                <span className="mt-4 text-xs text-green-600">Saved</span>
              )}
            </>
          ) : (
            <div className="text-right">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                Pull access
              </p>
              <p className="mt-0.5 text-sm font-medium text-gray-700">{minRoleInfo.label}</p>
            </div>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {/* Member access summary */}
      <div className="mt-4 border-t border-gray-100 pt-3">
        <p className="mb-2 text-xs font-medium text-gray-500">Member access</p>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => {
            const effectivePolicy = envPolicies.find((p) => p.userId === m.userId)
            const overrideLabel = effectivePolicy
              ? effectivePolicy.effect === 'ALLOW'
                ? `ALLOW ${effectivePolicy.action}`
                : `DENY ${effectivePolicy.action}`
              : null

            return (
              <div
                key={m.userId}
                className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1"
                title={
                  overrideLabel
                    ? `${m.githubLogin}: ${overrideLabel} (override)`
                    : `${m.githubLogin}: role-based access`
                }
              >
                {m.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.image} alt="" className="h-4 w-4 rounded-full" />
                )}
                <span className="text-xs text-gray-700">
                  {m.githubLogin ?? m.userId.slice(0, 8)}
                </span>
                {m.role && (
                  <span
                    className={`rounded px-1 py-0.5 text-[10px] font-medium ${ROLE_STYLES[m.role]}`}
                  >
                    {m.role}
                  </span>
                )}
                {overrideLabel && (
                  <span
                    className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                      effectivePolicy?.effect === 'ALLOW'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {overrideLabel}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Overrides tab ────────────────────────────────────────────────────────────

function OverridesTab({
  repoId,
  members,
  environments,
  policies: initialPolicies,
  isAdmin,
}: {
  repoId: string
  members: AccessMember[]
  environments: AccessEnvironment[]
  policies: PolicyOverride[]
  isAdmin: boolean
}) {
  const [policies, setPolicies] = useState<PolicyOverride[]>(initialPolicies)
  const [showForm, setShowForm] = useState(false)

  async function deletePolicy(policyId: string) {
    const res = await fetch(`/api/repos/${repoId}/access/policies/${policyId}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      setPolicies((prev) => prev.filter((p) => p.id !== policyId))
    }
  }

  function handleCreated(policy: PolicyOverride) {
    setPolicies((prev) => [policy, ...prev])
    setShowForm(false)
  }

  const envMap = Object.fromEntries(environments.map((e) => [e.id, e.name]))

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Access overrides</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Override the default role-based access for specific users. DENY takes precedence.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:border-gray-300 hover:bg-gray-50"
          >
            + Add override
          </button>
        )}
      </div>

      {showForm && isAdmin && (
        <AddOverrideForm
          repoId={repoId}
          members={members}
          environments={environments}
          onCreated={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {policies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 px-6 py-8 text-center">
          <p className="text-sm text-gray-500">No access overrides configured.</p>
          <p className="mt-1 text-xs text-gray-400">
            All members use their default role-based access.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {policies.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between px-5 py-3"
            >
              <div className="flex items-center gap-3">
                {p.userImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.userImage} alt="" className="h-6 w-6 rounded-full" />
                )}
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {p.githubLogin ? `@${p.githubLogin}` : p.userId.slice(0, 8)}
                  </span>
                  <span className="mx-2 text-gray-300">·</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${EFFECT_STYLES[p.effect]}`}
                  >
                    {p.effect}
                  </span>
                  <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                    {p.action}
                  </span>
                  {p.environmentId ? (
                    <span className="ml-1.5 text-xs text-gray-400">
                      in <span className="font-medium text-gray-600">{envMap[p.environmentId] ?? p.environmentId}</span>
                    </span>
                  ) : (
                    <span className="ml-1.5 text-xs text-gray-400">repo-wide</span>
                  )}
                </div>
              </div>

              {isAdmin && (
                <button
                  onClick={() => deletePolicy(p.id)}
                  className="text-xs text-gray-400 hover:text-red-600"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Add override form ────────────────────────────────────────────────────────

function AddOverrideForm({
  repoId,
  members,
  environments,
  onCreated,
  onCancel,
}: {
  repoId: string
  members: AccessMember[]
  environments: AccessEnvironment[]
  onCreated: (policy: PolicyOverride) => void
  onCancel: () => void
}) {
  const [userId, setUserId] = useState(members[0]?.userId ?? '')
  const [environmentId, setEnvironmentId] = useState<string>('') // '' = repo-wide
  const [action, setAction] = useState<'PULL' | 'WRITE'>('PULL')
  const [effect, setEffect] = useState<'ALLOW' | 'DENY'>('DENY')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/repos/${repoId}/access/policies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          action,
          effect,
          ...(environmentId ? { environmentId } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Failed to create override')
      } else {
        onCreated(data as PolicyOverride)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4"
    >
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Add access override</h3>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-xs font-medium text-gray-600">User</label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.githubLogin ?? m.userId.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600">Environment</label>
          <select
            value={environmentId}
            onChange={(e) => setEnvironmentId(e.target.value)}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            <option value="">All environments</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600">Action</label>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as 'PULL' | 'WRITE')}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            <option value="PULL">PULL (reveal secrets)</option>
            <option value="WRITE">WRITE (set secrets)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600">Effect</label>
          <select
            value={effect}
            onChange={(e) => setEffect(e.target.value as 'ALLOW' | 'DENY')}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            <option value="DENY">DENY (block beyond role)</option>
            <option value="ALLOW">ALLOW (grant beyond role)</option>
          </select>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create override'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
