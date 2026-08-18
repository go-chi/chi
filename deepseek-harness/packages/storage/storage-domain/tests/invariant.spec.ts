import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage from '@deepseek-ai/dsh-storage'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import * as DomainInvariantCompanion from '@deepseek-ai/dsh-storage-domain/invariant'
import { DomainFacility, defineDomain, domainTable } from '../src/index.ts'
import type { DomainChanged } from '../src/events.ts'
import { MemoryStorageBackend } from './helpers/memory-backend.ts'

const itemSchema = z.object({ n: z.number() })
type Item = z.infer<typeof itemSchema>

const spec = defineDomain({
  name: 'inv',
  version: 1,
  global: { schema: itemSchema, initial: { n: 0 } },
  tables: { rows: domainTable<string, Item>(itemSchema) },
})

async function setup() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(DomainInvariantCompanion)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  return { ctx, facility }
}

const invariantViolation: unknown = expect.objectContaining<Partial<InvariantError>>({
  code: 'INVARIANT',
  packageName: '@deepseek-ai/dsh-storage-domain',
})

describe('domain change-event invariants', () => {
  it('accepts every write shape emitted by the real write paths', async () => {
    const { facility } = await setup()
    const domain = await facility.open(spec)
    const rows = domain.table('rows')
    await rows.put('a', { n: 1 })
    await rows.update('a', current => ({ n: current.n + 1 }))
    await expect(rows.delete('a')).resolves.toBe(true)
    await domain.global.set({ n: 5 })
  })

  it('rejects an event for a domain that is not open', async () => {
    const { ctx } = await setup()
    expect(() => { ctx.emit('domain/changed', {
      domain: 'ghost', table: 'rows', key: 'a', operation: 'put', value: { n: 1 },
    }) }).toThrow(invariantViolation)
  })

  it('rejects a put event whose value is not the in-memory record', async () => {
    const { ctx, facility } = await setup()
    const domain = await facility.open(spec)
    await domain.table('rows').put('a', { n: 1 })
    expect(() => { ctx.emit('domain/changed', {
      domain: 'inv', table: 'rows', key: 'a', operation: 'put', value: { n: 999 },
    }) }).toThrow(invariantViolation)
  })

  it('rejects a deletion event while the record is still in memory', async () => {
    const { ctx, facility } = await setup()
    const domain = await facility.open(spec)
    await domain.table('rows').put('a', { n: 1 })
    expect(() => { ctx.emit('domain/changed', {
      domain: 'inv', table: 'rows', key: 'a', operation: 'deleted',
    }) }).toThrow(invariantViolation)
  })

  it('rejects a global event whose value is not the in-memory global', async () => {
    const { ctx, facility } = await setup()
    await facility.open(spec)
    expect(() => { ctx.emit('domain/changed', {
      domain: 'inv', table: '', key: '', operation: 'put', value: { n: 42 },
    }) }).toThrow(invariantViolation)
  })

  it('tolerates operations outside the closed union without failing falsely', async () => {
    const { ctx, facility } = await setup()
    const domain = await facility.open(spec)
    await domain.table('rows').put('a', { n: 1 })
    // Merge-hostile input: the closed union's satisfies-never default arm is
    // unreachable in typed code; an untyped emit must not crash the check.
    expect(() => { ctx.emit('domain/changed', {
      domain: 'inv', table: 'rows', key: 'a', operation: 'exotic',
    } as unknown as DomainChanged) }).not.toThrow()
  })
})
