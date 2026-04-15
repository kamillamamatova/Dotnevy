'use client'

import { useState, useCallback } from 'react'

// ─── Data types ───────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string
  action: string
  createdAt: string
  actor: { userId: string; githubLogin: string | null; image: string | null }
  environment: { id: string | null; name: string; type: string } | null
  detail: Record<string, unknown> | null
}

// ─── Action metadata ──────────────────────────────────────────────────────────

type ActionMeta = {
  label: string
  category: 'secret' | 'template' | 'environment' | 'access' | 'repo'
  dotColor: string
}

const ACTION_META: Record<string, ActionMeta> = {
  PULL_VARS:          { label: 'Revealed secret',        category: 'secret',      dotColor: 'bg-blue-400' },
  SET_VAR:            { label: 'Set secret',             category: 'secret',      dotColor: 'bg-blue-600' },
  DELETE_VAR:         { label: 'Cleared secret',         category: 'secret',      dotColor: 'bg-red-400' },
  ROTATE_VAR:         { label: 'Rotated encryption',     category: 'secret',      dotColor: 'bg-orange-400' },
  CREATE_TEMPLATE:    { label: 'Created variable',       category: 'template',    dotColor: 'bg-green-500' },
  UPDATE_TEMPLATE:    { label: 'Updated variable',       category: 'template',    dotColor: 'bg-green-400' },
  DELETE_TEMPLATE:    { label: 'Deleted variable',       category: 'template',    dotColor: 'bg-red-500' },
  CREATE_ENVIRONMENT: { label: 'Created environment',    category: 'environment', dotColor: 'bg-purple-400' },
  UPDATE_ENVIRONMENT: { label: 'Changed env access',     category: 'environment', dotColor: 'bg-purple-500' },
  DELETE_ENVIRONMENT: { label: 'Deleted environment',    category: 'environment', dotColor: 'bg-red-600' },
  GRANT_ACCESS:       { label: 'Granted access',         category: 'access',      dotColor: 'bg-teal-400' },
  REVOKE_ACCESS:      { label: 'Revoked access',         category: 'access',      dotColor: 'bg-orange-500' },
  REGISTER_REPO:      { label: 'Connected repo',         category: 'repo',        dotColor: 'bg-gray-400' },
  REMOVE_REPO:        { label: 'Removed repo',           category: 'repo',        dotColor: 'bg-gray-600' },
}

const CATEGORY_LABELS: Record<string, string> = {
  secret: 'Secret',
  template: 'Variable',
  environment: 'Environment',
  access: 'Access',
  repo: 'Repository',
}

// ─── Description builder ──────────────────────────────────────────────────────
// Produces a human-readable sentence per entry without exposing secret values.

function buildDescription(action: string, detail: Record<string, unknown> | null): string {
  if (!detail) return ACTION_META[action]?.label ?? action

  switch (action) {
    case 'PULL_VARS': {
      const src = detail.source === 'cli' ? ' via CLI' : detail.source === 'export' ? ' via export' : ''
      return `Revealed ${String(detail.key ?? '?')} (v${String(detail.version ?? '?')})${src}`
    }
    case 'SET_VAR': {
      const prev = detail.previousVersion
      const isNew = prev === null || prev === undefined
      return isNew
        ? `Set ${String(detail.key ?? '?')} (first version)`
        : `Updated ${String(detail.key ?? '?')} → v${String(detail.version ?? '?')}`
    }
    case 'DELETE_VAR':
      return `Cleared ${String(detail.key ?? '?')}`
    case 'CREATE_TEMPLATE':
      return `Defined variable ${String(detail.key ?? '?')}${detail.isRequired ? ' (required)' : ''}`
    case 'UPDATE_TEMPLATE': {
      const fields = Array.isArray(detail.changes) ? (detail.changes as string[]).join(', ') : ''
      return `Updated ${String(detail.key ?? '?')} — changed ${fields}`
    }
    case 'DELETE_TEMPLATE': {
      const v = Number(detail.versionCount ?? 0)
      return `Deleted ${String(detail.key ?? '?')} and ${v} version${v === 1 ? '' : 's'}`
    }
    case 'CREATE_ENVIRONMENT':
      return `Created environment "${String(detail.name ?? '?')}" (${String(detail.type ?? '').toLowerCase()}, min ${String(detail.minRole ?? '?')})`
    case 'UPDATE_ENVIRONMENT': {
      const changes = Array.isArray(detail.changes) ? (detail.changes as string[]) : []
      if (changes.includes('minRole') && detail.newMinRole) {
        return `Changed "${String(detail.name ?? '?')}" pull access to ${String(detail.newMinRole)}`
      }
      return `Updated "${String(detail.name ?? '?')}" settings`
    }
    case 'DELETE_ENVIRONMENT':
      return `Deleted environment "${String(detail.name ?? '?')}"`
    case 'GRANT_ACCESS': {
      const scope = detail.environmentName ? ` in ${String(detail.environmentName)}` : ' (repo-wide)'
      return `Granted @${String(detail.targetUser ?? '?')} ${String(detail.policyAction ?? '')} access${scope}`
    }
    case 'REVOKE_ACCESS': {
      const scope = detail.environmentName ? ` in ${String(detail.environmentName)}` : ' (repo-wide)'
      return `Revoked @${String(detail.targetUser ?? '?')} access${scope}`
    }
    case 'REGISTER_REPO':
      return `Connected ${String(detail.owner ?? '?')}/${String(detail.name ?? '?')}`
    case 'REMOVE_REPO':
      return `Removed ${String(detail.owner ?? '?')}/${String(detail.name ?? '?')}`
    default:
      return ACTION_META[action]?.label ?? action
  }
}

// ─── Relative time ────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  repoId: string
  environments: Array<{ id: string; name: string }>
  action: string
  envId: string
  onFilterChange: (action: string, envId: string) => void
}

export function AuditFilterBar({
  environments,
  action,
  envId,
  onFilterChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <label className="sr-only">Action type</label>
        <select
          value={action}
          onChange={(e) => onFilterChange(e.target.value, envId)}
          className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
        >
          <option value="">All actions</option>
          {Object.entries(CATEGORY_LABELS).map(([cat, catLabel]) => (
            <optgroup key={cat} label={catLabel}>
              {Object.entries(ACTION_META)
                .filter(([, m]) => m.category === cat)
                .map(([a, m]) => (
                  <option key={a} value={a}>
                    {m.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div>
        <label className="sr-only">Environment</label>
        <select
          value={envId}
          onChange={(e) => onFilterChange(action, e.target.value)}
          className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
        >
          <option value="">All environments</option>
          {environments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {(action || envId) && (
        <button
          onClick={() => onFilterChange('', '')}
          className="text-sm text-gray-400 hover:text-gray-700"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

// ─── Audit log list ───────────────────────────────────────────────────────────

interface AuditLogListProps {
  entries: AuditEntry[]
  total: number
  page: number
  pages: number
  onPageChange?: (page: number) => void
  compact?: boolean   // true = no pagination, fewer details (for Activity tab summary)
}

export function AuditLogList({
  entries,
  total,
  page,
  pages,
  onPageChange,
  compact = false,
}: AuditLogListProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-6 py-8 text-center">
        <p className="text-sm text-gray-500">No activity found.</p>
      </div>
    )
  }

  return (
    <div>
      <ul className="space-y-0">
        {entries.map((entry, i) => {
          const meta = ACTION_META[entry.action] ?? {
            label: entry.action,
            category: 'repo',
            dotColor: 'bg-gray-400',
          }
          const description = buildDescription(entry.action, entry.detail)

          return (
            <li
              key={entry.id}
              className={`flex items-start gap-4 py-3 ${
                i < entries.length - 1 ? 'border-b border-gray-100' : ''
              }`}
            >
              {/* Timeline dot */}
              <div className="mt-1.5 flex-shrink-0">
                <div className={`h-2 w-2 rounded-full ${meta.dotColor}`} />
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900">{description}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
                  {entry.actor.githubLogin && (
                    <span className="flex items-center gap-1">
                      {entry.actor.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={entry.actor.image}
                          alt=""
                          className="h-3.5 w-3.5 rounded-full"
                        />
                      )}
                      @{entry.actor.githubLogin}
                    </span>
                  )}
                  {entry.environment && !compact && (
                    <>
                      <span className="text-gray-300">·</span>
                      <span>{entry.environment.name}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Timestamp */}
              <time
                dateTime={entry.createdAt}
                title={new Date(entry.createdAt).toLocaleString()}
                className="flex-shrink-0 text-xs text-gray-400"
              >
                {relativeTime(entry.createdAt)}
              </time>
            </li>
          )
        })}
      </ul>

      {/* Pagination */}
      {!compact && pages > 1 && onPageChange && (
        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4 text-sm">
          <span className="text-xs text-gray-400">
            {total} total event{total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 disabled:opacity-30 hover:bg-gray-50"
            >
              ← Prev
            </button>
            <span className="text-xs text-gray-500">
              {page} / {pages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= pages}
              className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 disabled:opacity-30 hover:bg-gray-50"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Full activity view (with filters, used on /activity page) ────────────────

interface ActivityViewProps {
  repoId: string
  initialEntries: AuditEntry[]
  initialTotal: number
  initialPages: number
  environments: Array<{ id: string; name: string }>
}

export function ActivityView({
  repoId,
  initialEntries,
  initialTotal,
  initialPages,
  environments,
}: ActivityViewProps) {
  const [entries, setEntries] = useState(initialEntries)
  const [total, setTotal] = useState(initialTotal)
  const [pages, setPages] = useState(initialPages)
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('')
  const [envFilter, setEnvFilter] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchEntries = useCallback(
    async (newAction: string, newEnv: string, newPage: number) => {
      setLoading(true)
      try {
        const qs = new URLSearchParams()
        if (newAction) qs.set('action', newAction)
        if (newEnv) qs.set('envId', newEnv)
        if (newPage > 1) qs.set('page', String(newPage))
        const res = await fetch(`/api/repos/${repoId}/audit?${qs}`)
        if (res.ok) {
          const data = await res.json()
          setEntries(data.entries)
          setTotal(data.total)
          setPages(data.pages)
        }
      } finally {
        setLoading(false)
      }
    },
    [repoId],
  )

  function handleFilterChange(newAction: string, newEnv: string) {
    setActionFilter(newAction)
    setEnvFilter(newEnv)
    setPage(1)
    fetchEntries(newAction, newEnv, 1)
  }

  function handlePageChange(newPage: number) {
    setPage(newPage)
    fetchEntries(actionFilter, envFilter, newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <AuditFilterBar
          repoId={repoId}
          environments={environments}
          action={actionFilter}
          envId={envFilter}
          onFilterChange={handleFilterChange}
        />
        <span className="text-xs text-gray-400">
          {total} event{total === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">Loading…</div>
      ) : (
        <AuditLogList
          entries={entries}
          total={total}
          page={page}
          pages={pages}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  )
}
