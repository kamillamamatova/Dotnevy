'use client'

import { useState } from 'react'

export interface Template {
  id: string
  key: string
  description: string | null
  isRequired: boolean
  defaultValue: string | null
  createdAt: string
}

interface Props {
  repoId: string
  envId: string
  initialTemplates: Template[]
  canManage: boolean
}

type EditState = { id: string; description: string; isRequired: boolean; defaultValue: string }

export function TemplateManager({ repoId, envId, initialTemplates, canManage }: Props) {
  const [templates, setTemplates] = useState<Template[]>(initialTemplates)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  // ─── Add template ─────────────────────────────────────────────────────────

  const [newKey, setNewKey] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newIsRequired, setNewIsRequired] = useState(false)
  const [newDefaultValue, setNewDefaultValue] = useState('')
  const [addLoading, setAddLoading] = useState(false)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null)
    setAddLoading(true)

    try {
      const res = await fetch(`/api/repos/${repoId}/environments/${envId}/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: newKey.trim().toUpperCase(),
          description: newDescription.trim() || undefined,
          isRequired: newIsRequired,
          defaultValue: newDefaultValue.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setAddError(data.message ?? data.error ?? 'Failed to add variable.')
        return
      }

      setTemplates((prev) => [...prev, data].sort((a, b) => a.key.localeCompare(b.key)))
      setNewKey('')
      setNewDescription('')
      setNewIsRequired(false)
      setNewDefaultValue('')
      setShowAddForm(false)
    } finally {
      setAddLoading(false)
    }
  }

  // ─── Edit template ────────────────────────────────────────────────────────

  function startEdit(t: Template) {
    setEditingId(t.id)
    setEditState({
      id: t.id,
      description: t.description ?? '',
      isRequired: t.isRequired,
      defaultValue: t.defaultValue ?? '',
    })
    setEditError(null)
  }

  async function handleSaveEdit(templateId: string) {
    if (!editState) return
    setEditError(null)

    try {
      const res = await fetch(
        `/api/repos/${repoId}/environments/${envId}/templates/${templateId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: editState.description.trim() || null,
            isRequired: editState.isRequired,
            defaultValue: editState.defaultValue.trim() || null,
          }),
        },
      )

      const data = await res.json()
      if (!res.ok) {
        setEditError(data.message ?? data.error ?? 'Failed to save.')
        return
      }

      setTemplates((prev) =>
        prev.map((t) =>
          t.id === templateId
            ? { ...t, description: data.description, isRequired: data.isRequired, defaultValue: data.defaultValue }
            : t,
        ),
      )
      setEditingId(null)
      setEditState(null)
    } catch {
      setEditError('Network error — please try again.')
    }
  }

  // ─── Delete template ──────────────────────────────────────────────────────

  async function handleDelete(templateId: string) {
    setDeletingId(templateId)

    try {
      const res = await fetch(
        `/api/repos/${repoId}/environments/${envId}/templates/${templateId}`,
        { method: 'DELETE' },
      )
      if (res.ok) {
        setTemplates((prev) => prev.filter((t) => t.id !== templateId))
      }
    } finally {
      setDeletingId(null)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {templates.length === 0 && !showAddForm ? (
        <EmptyTemplateState canManage={canManage} onAdd={() => setShowAddForm(true)} />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          {/* Template list */}
          {templates.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {templates.map((t) => (
                <li key={t.id} className="px-5 py-4">
                  {editingId === t.id && editState ? (
                    <EditRow
                      t={t}
                      state={editState}
                      onChange={setEditState}
                      onSave={() => handleSaveEdit(t.id)}
                      onCancel={() => { setEditingId(null); setEditState(null) }}
                      error={editError}
                    />
                  ) : (
                    <ViewRow
                      t={t}
                      canManage={canManage}
                      deleting={deletingId === t.id}
                      onEdit={() => startEdit(t)}
                      onDelete={() => handleDelete(t.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Add form inline */}
          {showAddForm && canManage && (
            <div className="border-t border-dashed border-gray-200 bg-gray-50 px-5 py-5">
              <p className="mb-4 text-sm font-medium text-gray-700">New variable</p>
              <form onSubmit={handleAdd} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600">
                      Key <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value.toUpperCase())}
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
                      Default value{' '}
                      <span className="font-normal text-gray-400">(non-secret only)</span>
                    </label>
                    <input
                      type="text"
                      value={newDefaultValue}
                      onChange={(e) => setNewDefaultValue(e.target.value)}
                      placeholder="3000"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600">Description</label>
                  <input
                    type="text"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="What this variable is used for"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                </div>

                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newIsRequired}
                    onChange={(e) => setNewIsRequired(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">
                    Required — warn if no value is set
                  </span>
                </label>

                {addError && (
                  <p className="text-sm text-red-600">{addError}</p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={addLoading || !newKey.trim()}
                    className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
                  >
                    {addLoading ? 'Adding…' : 'Add variable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAddForm(false); setAddError(null) }}
                    className="text-sm text-gray-500 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Add button row */}
          {!showAddForm && canManage && (
            <div className={`${templates.length > 0 ? 'border-t border-gray-100' : ''} px-5 py-3`}>
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add variable
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ViewRow({
  t,
  canManage,
  deleting,
  onEdit,
  onDelete,
}: {
  t: Template
  canManage: boolean
  deleting: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <code className="font-mono text-sm font-medium text-gray-900">{t.key}</code>
          {t.isRequired && (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-600">
              Required
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-gray-500">
          {t.description && <span>{t.description}</span>}
          {t.defaultValue && (
            <span>
              default:{' '}
              <code className="rounded bg-gray-100 px-1 text-gray-700">{t.defaultValue}</code>
            </span>
          )}
        </div>
      </div>

      {canManage && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onEdit}
            className="text-xs text-gray-400 hover:text-gray-700"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
          >
            {deleting ? '…' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}

function EditRow({
  t,
  state,
  onChange,
  onSave,
  onCancel,
  error,
}: {
  t: Template
  state: EditState
  onChange: (s: EditState) => void
  onSave: () => void
  onCancel: () => void
  error: string | null
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <code className="font-mono text-sm font-medium text-gray-900">{t.key}</code>
        <span className="text-xs text-gray-400">(key is immutable)</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600">Description</label>
          <input
            type="text"
            value={state.description}
            onChange={(e) => onChange({ ...state, description: e.target.value })}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">
            Default value <span className="font-normal text-gray-400">(non-secret)</span>
          </label>
          <input
            type="text"
            value={state.defaultValue}
            onChange={(e) => onChange({ ...state, defaultValue: e.target.value })}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={state.isRequired}
          onChange={(e) => onChange({ ...state, isRequired: e.target.checked })}
        />
        <span className="text-sm text-gray-700">Required</span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          Save
        </button>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-800">
          Cancel
        </button>
      </div>
    </div>
  )
}

function EmptyTemplateState({
  canManage,
  onAdd,
}: {
  canManage: boolean
  onAdd: () => void
}) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 px-8 py-10 text-center">
      <p className="text-sm font-medium text-gray-700">No variables defined yet</p>
      <p className="mt-1 text-xs text-gray-400">
        Add variable templates to document what this environment expects.
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
