'use client'

import { useState } from 'react'
import type { GitHubPermission } from '@pullenv/db'
import type { RepoRole } from '@pullenv/shared'

type Tab = 'environments' | 'access' | 'activity'

export interface Member {
  userId: string
  permission: GitHubPermission
  role: RepoRole | null
  githubLogin: string | null
  image: string | null
}

export interface ActivityEntry {
  id: string
  action: string
  createdAt: string
  githubLogin: string | null
  detail: Record<string, unknown> | null
}

interface Props {
  members: Member[]
  activity: ActivityEntry[]
}

export function RepoDetailTabs({ members, activity }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('environments')

  return (
    <div>
      {/* Tab bar */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {(['environments', 'access', 'activity'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 pb-3 pt-1 text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab panels */}
      <div className="mt-6">
        {activeTab === 'environments' && <EnvironmentsTab />}
        {activeTab === 'access' && <AccessTab members={members} />}
        {activeTab === 'activity' && <ActivityTab entries={activity} />}
      </div>
    </div>
  )
}

function EnvironmentsTab() {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center">
      <p className="text-sm font-medium text-gray-700">Environments</p>
      <p className="mt-1 text-xs text-gray-400">
        Environment and variable management is coming in Phase 4.
      </p>
    </div>
  )
}

const ROLE_STYLES: Record<string, string> = {
  READ: 'bg-gray-100 text-gray-600',
  WRITE: 'bg-blue-50 text-blue-700',
  ADMIN: 'bg-purple-50 text-purple-700',
}

function AccessTab({ members }: { members: Member[] }) {
  if (members.length === 0) {
    return <p className="text-sm text-gray-500">No members found.</p>
  }

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {members.map((m) => (
        <li key={m.userId} className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            {m.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.image} alt={m.githubLogin ?? ''} className="h-6 w-6 rounded-full" />
            )}
            <span className="text-sm font-medium text-gray-900">
              {m.githubLogin ? `@${m.githubLogin}` : m.userId}
            </span>
          </div>
          {m.role && (
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${ROLE_STYLES[m.role]}`}>
              {m.role}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

const ACTION_LABELS: Record<string, string> = {
  REGISTER_REPO: 'Connected repo',
  REMOVE_REPO: 'Removed repo',
  PULL_VARS: 'Pulled vars',
  SET_VAR: 'Set variable',
  DELETE_VAR: 'Deleted variable',
  ROTATE_VAR: 'Rotated variable',
  CREATE_ENVIRONMENT: 'Created environment',
  DELETE_ENVIRONMENT: 'Deleted environment',
  GRANT_ACCESS: 'Granted access',
  REVOKE_ACCESS: 'Revoked access',
}

function ActivityTab({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">No activity yet.</p>
  }

  return (
    <ul className="space-y-1">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center justify-between rounded-md px-4 py-2.5 text-sm hover:bg-gray-50">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">
              {ACTION_LABELS[e.action] ?? e.action}
            </span>
            {e.githubLogin && (
              <span className="text-gray-500">by @{e.githubLogin}</span>
            )}
          </div>
          <time className="text-xs text-gray-400">
            {new Date(e.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </li>
      ))}
    </ul>
  )
}
