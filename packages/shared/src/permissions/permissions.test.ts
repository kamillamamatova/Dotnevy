import { describe, it, expect } from 'vitest'
import { hasRole, canPull, canWrite, canAdmin, defaultMinRoleForEnvType } from './index.js'
import type { RepoRole } from '../types/index.js'

// ─── hasRole ──────────────────────────────────────────────────────────────────

describe('hasRole', () => {
  it('allows a role to meet itself', () => {
    expect(hasRole('READ', 'READ')).toBe(true)
    expect(hasRole('WRITE', 'WRITE')).toBe(true)
    expect(hasRole('ADMIN', 'ADMIN')).toBe(true)
  })

  it('allows higher roles to meet lower requirements', () => {
    expect(hasRole('WRITE', 'READ')).toBe(true)
    expect(hasRole('ADMIN', 'READ')).toBe(true)
    expect(hasRole('ADMIN', 'WRITE')).toBe(true)
  })

  it('rejects lower roles against higher requirements', () => {
    expect(hasRole('READ', 'WRITE')).toBe(false)
    expect(hasRole('READ', 'ADMIN')).toBe(false)
    expect(hasRole('WRITE', 'ADMIN')).toBe(false)
  })
})

// ─── canPull ──────────────────────────────────────────────────────────────────

describe('canPull', () => {
  const cases: Array<[RepoRole, RepoRole, boolean]> = [
    // [userRole, envMinRole, expected]
    ['READ', 'READ', true],
    ['WRITE', 'READ', true],
    ['ADMIN', 'READ', true],
    ['READ', 'WRITE', false],
    ['WRITE', 'WRITE', true],
    ['ADMIN', 'WRITE', true],
    ['READ', 'ADMIN', false],
    ['WRITE', 'ADMIN', false],
    ['ADMIN', 'ADMIN', true],
  ]

  it.each(cases)(
    'canPull(%s, minRole=%s) → %s',
    (userRole, minRole, expected) => {
      expect(canPull(userRole, minRole)).toBe(expected)
    },
  )
})

// ─── canWrite ─────────────────────────────────────────────────────────────────

describe('canWrite', () => {
  it('allows WRITE and ADMIN', () => {
    expect(canWrite('WRITE')).toBe(true)
    expect(canWrite('ADMIN')).toBe(true)
  })

  it('rejects READ', () => {
    expect(canWrite('READ')).toBe(false)
  })
})

// ─── canAdmin ─────────────────────────────────────────────────────────────────

describe('canAdmin', () => {
  it('allows only ADMIN', () => {
    expect(canAdmin('ADMIN')).toBe(true)
  })

  it('rejects READ and WRITE', () => {
    expect(canAdmin('READ')).toBe(false)
    expect(canAdmin('WRITE')).toBe(false)
  })
})

// ─── defaultMinRoleForEnvType ─────────────────────────────────────────────────

describe('defaultMinRoleForEnvType', () => {
  it('requires ADMIN for PRODUCTION', () => {
    expect(defaultMinRoleForEnvType('PRODUCTION')).toBe('ADMIN')
  })

  it('requires WRITE for STAGING', () => {
    expect(defaultMinRoleForEnvType('STAGING')).toBe('WRITE')
  })

  it('requires only READ for DEVELOPMENT and CUSTOM', () => {
    expect(defaultMinRoleForEnvType('DEVELOPMENT')).toBe('READ')
    expect(defaultMinRoleForEnvType('CUSTOM')).toBe('READ')
  })
})
