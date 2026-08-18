import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import * as WorkspaceInvariant from '../src/invariant.ts'
import { WorkspaceId } from '../src/index.ts'

/** Boot the invariant service plus the companion over a stubbed registry knowing exactly `ids`. */
async function setup(ids: string[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => (ids.includes(id) ? { id } : undefined),
  })
  await ctx.plugin(WorkspaceInvariant)
  return ctx
}

type ChangeLocation = Partial<Pick<DomainChanged, 'domain' | 'table' | 'key'>>

const put = (overrides?: ChangeLocation): DomainChanged => ({
  domain: 'workspace',
  table: 'workspaces',
  key: 'w1',
  operation: 'put',
  value: {},
  ...overrides,
})

const deleted = (): DomainChanged => ({
  domain: 'workspace',
  table: 'workspaces',
  key: 'w1',
  operation: 'deleted',
})

describe('workspace cache/table invariant', () => {
  it('accepts a put whose record has a cached entity and ignores foreign events', async () => {
    const ctx = await setup(['w1'])
    expect(() => { ctx.emit('domain/changed', put()) }).not.toThrow()
    // Other domains and other tables are out of scope, whatever their shape.
    expect(() => { ctx.emit('domain/changed', put({ domain: 'other', key: 'missing' })) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', put({ table: 'other', key: 'missing' })) }).not.toThrow()
  })

  it('fails deletion while the registry still publishes the entity', async () => {
    const ctx = await setup(['w1'])
    expect(() => { ctx.emit('domain/changed', deleted()) })
      .toThrow(/cache still publishes/)
  })

  it('allows deletion after the registry removed the cache entry for rollback or explicit deletion', async () => {
    const ctx = await setup([])
    expect(() => { ctx.emit('domain/changed', deleted()) }).not.toThrow()
  })

  it('fails a put whose record the registry cache does not hold', async () => {
    const ctx = await setup([])
    expect(() => { ctx.emit('domain/changed', put()) }).toThrow(/diverged/)
  })
})
