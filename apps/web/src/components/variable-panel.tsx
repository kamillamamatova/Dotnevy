'use client'

import { useState, useEffect, useRef } from 'react'

// ─── History types ─────────────────────────────────────────────────────────────

interface HistoryEntry {
  version: number
  createdAt: string
  createdBy: string | null
}

interface HistoryData {
  templateId: string
  key: string
  totalVersions: number
  versions: HistoryEntry[]
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VariableRow {
  // Template definition (immutable after creation except description/isRequired/defaultValue)
  id: string
  key: string
  description: string | null
  isRequired: boolean
  defaultValue: string | null
  // Current secret value metadata — no plaintext, no ciphertext
  hasSecret: boolean
  currentVersion: number | null
  updatedAt: string | null     // ISO string
  updatedBy: string | null     // githubLogin
}

interface Props {
  repoId: string
  envId: string
  initialVariables: VariableRow[]
  canManage: boolean   // WRITE+ — can set values, add/edit/delete templates
  canReveal: boolean   // canPull(role, envMinRole) — can decrypt and view values
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VariablePanel({ repoId, envId, initialVariables, canManage, canReveal }: Props) {
  const [variables, setVariables] = useState<VariableRow[]>(initialVariables)
  const [showAddForm, setShowAddForm] = useState(false)

  // Which template is in "set value" mode
  const [settingValueFor, setSettingValueFor] = useState<string | null>(null)
  // Which template is in "edit template" mode
  const [editingTemplateFor, setEditingTemplateFor] = useState<string | null>(null)
  // Which template has its version history expanded
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null)
  // Whether the bulk-import form is open
  const [showImportForm, setShowImportForm] = useState(false)
  // Revealed values: templateId → { value, expiresAt }
  const [revealed, setRevealed] = useState<Record<string, { value: string; expiresAt: number }>>({})

  // Clear revealed values when they expire
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setRevealed((prev) => {
        const next = { ...prev }
        let changed = false
        for (const id of Object.keys(next)) {
          if (next[id].expiresAt <= now) {
            delete next[id]
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function onValueSaved(templateId: string, version: number, updatedAt: string) {
    setVariables((prev) =>
      prev.map((v) =>
        v.id === templateId
          ? { ...v, hasSecret: true, currentVersion: version, updatedAt, updatedBy: null }
          : v,
      ),
    )
    setSettingValueFor(null)
  }

  function onReveal(templateId: string, value: string) {
    setRevealed((prev) => ({
      ...prev,
      [templateId]: { value, expiresAt: Date.now() + 30_000 },
    }))
  }

  function hideRevealed(templateId: string) {
    setRevealed((prev) => {
      const next = { ...prev }
      delete next[templateId]
      return next
    })
  }

  function onTemplateUpdated(
    templateId: string,
    patch: Partial<Pick<VariableRow, 'description' | 'isRequired' | 'defaultValue'>>,
  ) {
    setVariables((prev) => prev.map((v) => (v.id === templateId ? { ...v, ...patch } : v)))
    setEditingTemplateFor(null)
  }

  function onTemplateDeleted(templateId: string) {
    setVariables((prev) => prev.filter((v) => v.id !== templateId))
  }

  function onTemplateAdded(row: VariableRow) {
    setVariables((prev) => [...prev, row].sort((a, b) => a.key.localeCompare(b.key)))
    setShowAddForm(false)
  }

  function onTemplatesBulkAdded(rows: VariableRow[]) {
    setVariables((prev) => [...prev, ...rows].sort((a, b) => a.key.localeCompare(b.key)))
    setShowImportForm(false)
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {variables.length === 0 && !showAddForm ? (
        <EmptyState canManage={canManage} onAdd={() => setShowAddForm(true)} />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          {variables.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {variables.map((row) => (
                <li key={row.id} className="px-5 py-4">
                  {editingTemplateFor === row.id ? (
                    <EditTemplateRow
                      repoId={repoId}
                      envId={envId}
                      row={row}
                      onSaved={onTemplateUpdated}
                      onCancel={() => setEditingTemplateFor(null)}
                    />
                  ) : settingValueFor === row.id ? (
                    <SetValueRow
                      repoId={repoId}
                      envId={envId}
                      row={row}
                      onSaved={onValueSaved}
                      onCancel={() => setSettingValueFor(null)}
                    />
                  ) : (
                    <>
                      <ViewRow
                        repoId={repoId}
                        envId={envId}
                        row={row}
                        revealed={revealed[row.id] ?? null}
                        canManage={canManage}
                        canReveal={canReveal}
                        isHistoryOpen={historyOpenFor === row.id}
                        onToggleHistory={() =>
                          setHistoryOpenFor((prev) => (prev === row.id ? null : row.id))
                        }
                        onSetValue={() => setSettingValueFor(row.id)}
                        onEditTemplate={() => setEditingTemplateFor(row.id)}
                        onDelete={() => onTemplateDeleted(row.id)}
                        onReveal={(v) => onReveal(row.id, v)}
                        onHideRevealed={() => hideRevealed(row.id)}
                      />
                      {historyOpenFor === row.id && (
                        <HistoryPanel repoId={repoId} envId={envId} templateId={row.id} />
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Add variable form */}
          {showAddForm && canManage && (
            <AddVariableForm
              repoId={repoId}
              envId={envId}
              onAdded={onTemplateAdded}
              onCancel={() => setShowAddForm(false)}
            />
          )}

          {/* Import .env.example form */}
          {showImportForm && canManage && (
            <ImportVariablesForm
              repoId={repoId}
              envId={envId}
              onImported={onTemplatesBulkAdded}
              onCancel={() => setShowImportForm(false)}
            />
          )}

          {/* Toolbar: add + import */}
          {!showAddForm && !showImportForm && canManage && (
            <div
              className={`${variables.length > 0 ? 'border-t border-gray-100' : ''} flex items-center gap-4 px-5 py-3`}
            >
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add variable
              </button>
              <span className="text-gray-200">|</span>
              <button
                onClick={() => setShowImportForm(true)}
                className="text-sm text-gray-400 hover:text-gray-700"
              >
                Import .env.example
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ViewRow — the main row state ────────────────────────────────────────────

function ViewRow({
  repoId,
  envId,
  row,
  revealed,
  canManage,
  canReveal,
  isHistoryOpen,
  onToggleHistory,
  onSetValue,
  onEditTemplate,
  onDelete,
  onReveal,
  onHideRevealed,
}: {
  repoId: string
  envId: string
  row: VariableRow
  revealed: { value: string; expiresAt: number } | null
  canManage: boolean
  canReveal: boolean
  isHistoryOpen: boolean
  onToggleHistory: () => void
  onSetValue: () => void
  onEditTemplate: () => void
  onDelete: () => void
  onReveal: (value: string) => void
  onHideRevealed: () => void
}) {
  const [revealLoading, setRevealLoading] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleReveal() {
    setRevealLoading(true)
    setRevealError(null)
    try {
      const res = await fetch(
        `/api/repos/${repoId}/environments/${envId}/values/${row.id}/reveal`,
      )
      const data = await res.json()
      if (!res.ok) {
        setRevealError(data.error ?? 'Failed to reveal')
        return
      }
      onReveal(data.value)
    } finally {
      setRevealLoading(false)
    }
  }

  async function handleCopy() {
    if (!revealed) return
    await navigator.clipboard.writeText(revealed.value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const secondsLeft = revealed ? Math.ceil((revealed.expiresAt - Date.now()) / 1000) : 0

  return (
    <div className="flex items-start justify-between gap-6">
      {/* Left: template definition */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <code className="font-mono text-sm font-semibold text-gray-900">{row.key}</code>
          {row.isRequired && (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-600">
              Required
            </span>
          )}
        </div>
        {row.description && (
          <p className="mt-0.5 text-xs text-gray-500">{row.description}</p>
        )}
        {row.defaultValue && !row.hasSecret && (
          <p className="mt-0.5 text-xs text-gray-400">
            default:{' '}
            <code className="rounded bg-gray-100 px-1 text-gray-600">{row.defaultValue}</code>
          </p>
        )}

        {/* Revealed value display */}
        {revealed && (
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-900 break-all">
              {revealed.value === '' ? <em className="text-gray-400">empty string</em> : revealed.value}
            </code>
            <button
              onClick={handleCopy}
              className="text-xs text-gray-400 hover:text-gray-700"
              title="Copy to clipboard"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            <button onClick={onHideRevealed} className="text-xs text-gray-400 hover:text-gray-700">
              Hide
            </button>
            <span className="text-xs text-gray-300">{secondsLeft}s</span>
          </div>
        )}
        {revealError && <p className="mt-1 text-xs text-red-500">{revealError}</p>}
      </div>

      {/* Right: value metadata + actions */}
      <div className="flex shrink-0 flex-col items-end gap-2">
        {/* Value status */}
        <div className="text-right">
          {row.hasSecret ? (
            <div className="text-xs text-gray-400">
              <span className="font-medium text-gray-600">v{row.currentVersion}</span>
              {row.updatedAt && (
                <>
                  {' · '}
                  <RelativeTime iso={row.updatedAt} />
                </>
              )}
              {row.updatedBy && <> · @{row.updatedBy}</>}
            </div>
          ) : (
            <span className="text-xs text-gray-400">No value set</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {row.hasSecret && (
            <button
              onClick={onToggleHistory}
              className={`text-xs ${isHistoryOpen ? 'font-medium text-gray-700' : 'text-gray-400 hover:text-gray-700'}`}
            >
              History
            </button>
          )}
          {canReveal && row.hasSecret && !revealed && (
            <button
              onClick={handleReveal}
              disabled={revealLoading}
              className="rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              {revealLoading ? '…' : 'Reveal'}
            </button>
          )}
          {canManage && (
            <button
              onClick={onSetValue}
              className="rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50"
            >
              {row.hasSecret ? 'Update' : 'Set value'}
            </button>
          )}
          {canManage && (
            <div className="relative">
              {deleteConfirming ? (
                <span className="flex items-center gap-1.5">
                  <button
                    onClick={() => onDelete()}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                  <button
                    onClick={() => setDeleteConfirming(false)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => onEditTemplate()}
                  className="text-xs text-gray-300 hover:text-gray-500"
                  title="Edit definition"
                >
                  ···
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── SetValueRow ──────────────────────────────────────────────────────────────

function SetValueRow({
  repoId,
  envId,
  row,
  onSaved,
  onCancel,
}: {
  repoId: string
  envId: string
  row: VariableRow
  onSaved: (templateId: string, version: number, updatedAt: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch(`/api/repos/${repoId}/environments/${envId}/values`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: row.id, value }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Failed to save.')
        return
      }

      onSaved(row.id, data.version, data.updatedAt)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <code className="font-mono text-sm font-semibold text-gray-900">{row.key}</code>
        {row.hasSecret && (
          <span className="text-xs text-gray-400">currently v{row.currentVersion}</span>
        )}
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative flex items-center">
          <input
            ref={inputRef}
            type={showValue ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={row.hasSecret ? 'Enter new value…' : 'Enter value…'}
            autoComplete="off"
            spellCheck={false}
            className="block w-full rounded-md border border-gray-300 pr-16 pl-3 py-2 font-mono text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
          <button
            type="button"
            onClick={() => setShowValue((s) => !s)}
            className="absolute right-3 text-xs text-gray-400 hover:text-gray-700"
          >
            {showValue ? 'Hide' : 'Show'}
          </button>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            {loading ? 'Saving…' : row.hasSecret ? 'Update value' : 'Set value'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── EditTemplateRow ──────────────────────────────────────────────────────────

function EditTemplateRow({
  repoId,
  envId,
  row,
  onSaved,
  onCancel,
}: {
  repoId: string
  envId: string
  row: VariableRow
  onSaved: (id: string, patch: Partial<Pick<VariableRow, 'description' | 'isRequired' | 'defaultValue'>>) => void
  onCancel: () => void
}) {
  const [description, setDescription] = useState(row.description ?? '')
  const [isRequired, setIsRequired] = useState(row.isRequired)
  const [defaultValue, setDefaultValue] = useState(row.defaultValue ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch(
        `/api/repos/${repoId}/environments/${envId}/templates/${row.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: description.trim() || null,
            isRequired,
            defaultValue: defaultValue.trim() || null,
          }),
        },
      )
      if (!res.ok) {
        const data = await res.json()
        setError(data.message ?? 'Failed to save.')
        return
      }
      onSaved(row.id, {
        description: description.trim() || null,
        isRequired,
        defaultValue: defaultValue.trim() || null,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <code className="font-mono text-sm font-semibold text-gray-900">{row.key}</code>
        <span className="text-xs text-gray-400">(key is immutable)</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">
              Default value <span className="font-normal text-gray-400">(non-secret)</span>
            </label>
            <input
              type="text"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={isRequired}
            onChange={(e) => setIsRequired(e.target.checked)}
          />
          <span className="text-sm text-gray-700">Required</span>
        </label>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            {loading ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── AddVariableForm ──────────────────────────────────────────────────────────

function AddVariableForm({
  repoId,
  envId,
  onAdded,
  onCancel,
}: {
  repoId: string
  envId: string
  onAdded: (row: VariableRow) => void
  onCancel: () => void
}) {
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [isRequired, setIsRequired] = useState(false)
  const [defaultValue, setDefaultValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch(`/api/repos/${repoId}/environments/${envId}/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key.trim().toUpperCase(),
          description: description.trim() || undefined,
          isRequired,
          defaultValue: defaultValue.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Failed to add variable.')
        return
      }

      onAdded({
        id: data.id,
        key: data.key,
        description: data.description,
        isRequired: data.isRequired,
        defaultValue: data.defaultValue,
        hasSecret: false,
        currentVersion: null,
        updatedAt: null,
        updatedBy: null,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border-t border-dashed border-gray-200 bg-gray-50 px-5 py-5">
      <p className="mb-4 text-sm font-medium text-gray-700">New variable</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600">
              Key <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="DATABASE_URL"
              required
              pattern="^[A-Z_][A-Z0-9_]*$"
              title="UPPER_SNAKE_CASE only"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 font-mono text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
            <p className="mt-0.5 text-xs text-gray-400">UPPER_SNAKE_CASE</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">
              Default value <span className="font-normal text-gray-400">(non-secret only)</span>
            </label>
            <input
              type="text"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              placeholder="3000"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this variable is used for"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={isRequired}
            onChange={(e) => setIsRequired(e.target.checked)}
          />
          <span className="text-sm text-gray-700">Required — warn if no value is set</span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading || !key.trim()}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            {loading ? 'Adding…' : 'Add variable'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── HistoryPanel ─────────────────────────────────────────────────────────────

function HistoryPanel({
  repoId,
  envId,
  templateId,
}: {
  repoId: string
  envId: string
  templateId: string
}) {
  const [data, setData] = useState<HistoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/repos/${repoId}/environments/${envId}/values/${templateId}/history`)
      .then((r) => r.json())
      .then((d: HistoryData) => setData(d))
      .catch(() => setError('Failed to load history'))
      .finally(() => setLoading(false))
  }, [repoId, envId, templateId])

  return (
    <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 p-3">
      {loading && <p className="text-xs text-gray-400">Loading history…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {data && data.versions.length === 0 && (
        <p className="text-xs text-gray-400">No version history yet.</p>
      )}
      {data && data.versions.length > 0 && (
        <>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Version history ({data.totalVersions})
          </p>
          <ul className="space-y-1.5">
            {data.versions.map((v, i) => (
              <li key={v.version} className="flex items-center gap-2.5 text-xs">
                <span className="w-8 shrink-0 font-mono font-semibold text-gray-700">
                  v{v.version}
                </span>
                {i === 0 && (
                  <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                    current
                  </span>
                )}
                <span className="text-gray-400">
                  <RelativeTime iso={v.createdAt} />
                </span>
                {v.createdBy && (
                  <span className="text-gray-500">by @{v.createdBy}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// ─── ImportVariablesForm ───────────────────────────────────────────────────────

function ImportVariablesForm({
  repoId,
  envId,
  onImported,
  onCancel,
}: {
  repoId: string
  envId: string
  onImported: (rows: VariableRow[]) => void
  onCancel: () => void
}) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ created: VariableRow[]; skipped: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleImport(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(
        `/api/repos/${repoId}/environments/${envId}/templates/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        },
      )
      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Import failed')
        return
      }
      setResult(data)
      if (data.created.length > 0) {
        onImported(data.created)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border-t border-dashed border-gray-200 bg-gray-50 px-5 py-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">Import from .env.example</p>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">
          ✕
        </button>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Paste the contents of your{' '}
        <code className="rounded bg-gray-100 px-1 font-mono">.env.example</code> file. Key templates
        will be created for any keys that don&apos;t already exist. Values are not stored — set
        secrets separately after import.
      </p>

      {result ? (
        <div>
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2">
            {result.created.length > 0 && (
              <p className="text-sm font-medium text-green-800">
                ✓ {result.created.length} variable{result.created.length !== 1 ? 's' : ''} added
              </p>
            )}
            {result.skipped.length > 0 && (
              <p className="mt-1 text-xs text-green-700">
                {result.skipped.length} already existed:{' '}
                {result.skipped.join(', ')}
              </p>
            )}
            {result.created.length === 0 && result.skipped.length === 0 && (
              <p className="text-sm font-medium text-green-800">No new variables found.</p>
            )}
          </div>
          <button
            onClick={onCancel}
            className="mt-3 text-sm text-gray-500 hover:text-gray-800"
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleImport}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              '# Database\nDATABASE_URL=\n\n# Auth\nNEXTAUTH_SECRET=\nNEXTAUTH_URL=http://localhost:3000'
            }
            rows={8}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs shadow-sm placeholder:text-gray-300 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            spellCheck={false}
          />
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={loading || !content.trim()}
              className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
            >
              {loading ? 'Importing…' : 'Import variables'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState({ canManage, onAdd }: { canManage: boolean; onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 px-8 py-10 text-center">
      <p className="text-sm font-medium text-gray-700">No variables defined yet</p>
      <p className="mt-1 text-xs text-gray-400">
        Add a variable template to define what this environment expects.
      </p>
      {canManage && (
        <button
          onClick={onAdd}
          className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Add first variable
        </button>
      )}
    </div>
  )
}

// ─── RelativeTime ─────────────────────────────────────────────────────────────

function RelativeTime({ iso }: { iso: string }) {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  let label: string
  if (diffMins < 1) label = 'just now'
  else if (diffMins < 60) label = `${diffMins}m ago`
  else if (diffHours < 24) label = `${diffHours}h ago`
  else if (diffDays < 30) label = `${diffDays}d ago`
  else label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return <time dateTime={iso}>{label}</time>
}
