import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage, { BackendRegistry, storageBackendServiceKey } from '../src/index.ts'
import type { StorageBackend } from '../src/index.ts'

const fakeBackend = (): StorageBackend => ({ close: async () => {} })

describe('BackendRegistry', () => {
  it('registers, resolves, and disposes names', () => {
    const registry = new BackendRegistry()
    const backend = fakeBackend()
    const dispose = registry.register('json', backend)
    expect(registry.get('json')).toBe(backend)
    expect(registry.names()).toEqual(['json'])
    dispose()
    expect(registry.names()).toEqual([])
    expect(() => registry.get('json')).toThrowMatchingObject({ code: 'backend-not-found' })
  })

  it('rejects duplicate names', () => {
    const registry = new BackendRegistry()
    registry.register('json', fakeBackend())
    expect(() => registry.register('json', fakeBackend())).toThrowMatchingObject({ code: 'duplicate-backend' })
  })
})

describe('Storage service', () => {
  it('derives stable lifecycle service keys for named backends', () => {
    expect(storageBackendServiceKey('json')).toBe('storage.backend.json')
    expect(storageBackendServiceKey('tenant-a')).toBe('storage.backend.tenant-a')
  })

  it('mounts on the context and exposes registry plus form mounting', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    expect(ctx.storage).toBeInstanceOf(Storage)

    const facility = { marker: true }
    const dispose = ctx.storage.mount('domain' as never, facility as never)
    expect(ctx.storage.form('domain' as never)).toBe(facility)
    expect(ctx.storage.domain).toBe(facility)
    expect(() => ctx.storage.mount('domain' as never, facility as never)).toThrowMatchingObject({
      code: 'duplicate-mount',
    })
    dispose()
    expect(() => ctx.storage.form('domain' as never)).toThrowMatchingObject({ code: 'form-not-mounted' })
    expect(() => ctx.storage.domain).toThrowMatchingObject({ code: 'form-not-mounted' })
  })

  it('ignores a stale disposer after dispose and re-mount / re-register', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const first = { first: true }
    const second = { second: true }
    const staleMount = ctx.storage.mount('domain' as never, first as never)
    staleMount()
    ctx.storage.mount('domain' as never, second as never)
    staleMount()
    expect(ctx.storage.form('domain' as never)).toBe(second)

    const backendA = fakeBackend()
    const backendB = fakeBackend()
    const staleRegister = ctx.storage.backend.register('json', backendA)
    staleRegister()
    ctx.storage.backend.register('json', backendB)
    staleRegister()
    expect(ctx.storage.backend.get('json')).toBe(backendB)
  })
})

expect.extend({
  toThrowMatchingObject(received: () => unknown, expected: object) {
    try {
      received()
    } catch (error) {
      const pass = Object.entries(expected).every(
        entry => (error as Record<string, unknown>)[entry[0]] === entry[1],
      )
      return { pass, message: () => `expected thrown error to match ${JSON.stringify(expected)}, got ${String(error)}` }
    }
    return { pass: false, message: () => 'expected function to throw' }
  },
})

declare module 'vitest' {
  interface Assertion<T> {
    toThrowMatchingObject(expected: object): T
  }
}
