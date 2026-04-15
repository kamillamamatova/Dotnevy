'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { GitHubPermission } from '@pullenv/db'
import type { RepoRole } from '@pullenv/shared'
import { AuditLogList, type AuditEntry } from '@/components/audit-log-list'

type Tab = 'environments' | 'access' | 'activity'

// ─── Shared types (passed from server components) ─────────────────────────────

export interface EnvironmentSummary {
  id: string
  name: string
  type: string
  minRole: RepoRole
  description: string | null
  templateCount: number
}

export interface Member {
  userId: string
  permission: GitHubPermission
  role: RepoRole | null
  githubLogin: string | null
  image: string | null
}

// Re-export AuditEntry as ActivityEntry so the server component (repo detail page)
// doesn't need to import from two places.
export type { AuditEntry as ActivityEntry } from '@/components/audit-log-list'

// ─── Root component ───────────────────────────────────────────────────────────

interface Props {
  repoId: string
  environments: EnvironmentSummary[]
  members: Member[]
  activity: AuditEntry[]
  canManage: boolean
}

export function RepoDetailTabs({ repoId, environments, members, activity, canManage }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('environments')

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'environments', label: 'Environments', count: environments.length },
    { id: 'access', label: 'Access', count: members.length },
    { id: 'activity', label: 'Activity' },
  ]

  return (
    <div>
      {/* Tab bar */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
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
              {tab.count !== undefined && tab.count > 0 && (
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab panels */}
      <div className="mt-6">
        {activeTab === 'environments' && (
          <EnvironmentsTab
            repoId={repoId}
            environments={environments}
            canManage={canManage}
          />
        )}
        {activeTab === 'access' && (
          <AccessTab repoId={repoId} members={members} canManage={canManage} />
        )}
        {activeTab === 'activity' && <ActivityTab repoId={repoId} entries={activity} />}
      </div>
    </div>
  )
}

// ─── Environments tab ─────────────────────────────────────────────────────────

const ENV_TYPE_STYLES: Record<string, { label: string; color: string }> = {
  DEVELOPMENT: { label: 'Dev', color: 'bg-green-100 text-green-800' },
  STAGING: { label: 'Staging', color: 'bg-yellow-100 text-yellow-800' },
  PRODUCTION: { label: 'Production', color: 'bg-red-100 text-red-800' },
  CUSTOM: { label: 'Custom', color: 'bg-gray-100 text-gray-700' },
}

const MIN_ROLE_LABELS: Record<RepoRole, string> = {
  READ: 'Any member',
  WRITE: 'Contributors+',
  ADMIN: 'Admins only',
}

function EnvironmentsTab({
  repoId,
  environments,
  canManage,
}: {
  repoId: string
  environments: EnvironmentSummary[]
  canManage: boolean
}) {
  if (environments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 px-8 py-12 text-center">
        <p className="text-sm font-medium text-gray-700">No environments set up yet</p>
        <p className="mt-1 text-xs text-gray-400">
          Add environments like development, staging, and production to manage your variables.
        </p>
        {canManage && (
          <Link
            href={`/repos/${repoId}/environments/new`}
            className="mt-4 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Set up first environment
          </Link>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        {canManage && (
          <Link
            href={`/repos/${repoId}/environments/new`}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:border-gray-300 hover:bg-gray-50"
          >
            + Add environment
          </Link>
        )}
      </div>

      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {environments.map((env) => {
          const typeInfo = ENV_TYPE_STYLES[env.type] ?? ENV_TYPE_STYLES.CUSTOM
          return (
            <li key={env.id}>
              <Link
                href={`/repos/${repoId}/environments/${env.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${typeInfo.color}`}>
                    {typeInfo.label}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{env.name}</p>
                    {env.description && (
                      <p className="text-xs text-gray-400">{env.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <span>
                    {env.templateCount === 0
                      ? 'No variables'
                      : `${env.templateCount} variable${env.templateCount === 1 ? '' : 's'}`}
                  </span>
                  <span>{MIN_ROLE_LABELS[env.minRole]}</span>
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Access tab ───────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, string> = {
  READ: 'bg-gray-100 text-gray-600',
  WRITE: 'bg-blue-50 text-blue-700',
  ADMIN: 'bg-purple-50 text-purple-700',
}

function AccessTab({
  repoId,
  members,
  canManage,
}: {
  repoId: string
  members: Member[]
  canManage: boolean
}) {
  return (
    <div>
      {/* Quick member list */}
      {members.length === 0 ? (
        <p className="text-sm text-gray-500">No members found.</p>
      ) : (
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
      )}

      {/* Link to full access management page */}
      <div className="mt-4 flex justify-end">
        <Link
          href={`/repos/${repoId}/access`}
          className="text-sm text-gray-500 hover:text-gray-800 underline-offset-2 hover:underline"
        >
          {canManage ? 'Manage access policies →' : 'View access policies →'}
        </Link>
      </div>
    </div>
  )
}

// ─── Activity tab ─────────────────────────────────────────────────────────────

function ActivityTab({ repoId, entries }: { repoId: string; entries: AuditEntry[] }) {
  return (
    <div>
      <AuditLogList
        entries={entries}
        total={entries.length}
        page={1}
        pages={1}
        compact
      />
      <div className="mt-4 flex justify-end">
        <Link
          href={`/repos/${repoId}/activity`}
          className="text-sm text-gray-500 hover:text-gray-800 underline-offset-2 hover:underline"
        >
          View full audit trail →
        </Link>
      </div>
    </div>
  )
}
