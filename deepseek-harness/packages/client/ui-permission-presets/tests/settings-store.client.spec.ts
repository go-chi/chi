import { describe, expect, it, vi } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  PermissionPresetSettingsController, permissionDefaultOf, refreshPermissionIfLoaded,
} from '../src/client/settings-store.ts'

const SCHEMA = {
  uid: 6,
  refs: {
    1: { type: 'const', value: 'read-only' },
    2: { type: 'const', meta: { description: 'Workspace' }, value: 'workspace-write' },
    3: { type: 'union', list: [1, 2] },
    6: { type: 'object', dict: { defaultPreset: 3 } },
  },
}

function view(defaultPreset: string, revision = 0, schema: SettingsNamespaceView['schema'] = SCHEMA): SettingsNamespaceView {
  return {
    ns: 'permission',
    schema,
    value: { defaultPreset },
    base: { defaultPreset: 'read-only' },
    applies: 'live',
    secrets: [],
    revision,
  }
}

function ok<T>(value: T) {
  return { rpcId: 'test', result: { ok: true as const, value } }
}

describe('permission settings store', () => {
  it('derives dynamic options and host labels from the descriptor schema', () => {
    expect(permissionDefaultOf(view('read-only'))).toEqual({
      currentValue: 'read-only',
      options: [
        { id: 'read-only', label: 'Read Only' },
        { id: 'workspace-write', label: 'Workspace' },
      ],
    })
    const single = {
      uid: 2,
      refs: {
        1: { type: 'const', meta: { description: '' }, value: 'read-only' },
        2: { type: 'object', dict: { defaultPreset: 1 } },
      },
    }
    expect(permissionDefaultOf(view('read-only', 0, single))).toEqual({
      currentValue: 'read-only',
      options: [{ id: 'read-only', label: 'Read Only' }],
    })
    const undescribed = {
      uid: 2,
      refs: {
        1: { type: 'const', meta: { description: 7 }, value: 'read-only' },
        2: { type: 'object', dict: { defaultPreset: 1 } },
      },
    }
    expect(permissionDefaultOf(view('read-only', 0, undescribed)).options)
      .toEqual([{ id: 'read-only', label: 'Read Only' }])
  })

  it('rejects malformed values and dynamic enums at the wire boundary', () => {
    expect(() => permissionDefaultOf({ ...view('read-only'), value: {} })).toThrow(/no defaultPreset value/)
    expect(() => permissionDefaultOf(view('read-only', 0, {
      uid: 1, refs: { 1: { type: 'object', dict: {} } },
    }))).toThrow(/no defaultPreset field/)
    expect(() => permissionDefaultOf(view('read-only', 0, {
      uid: 2,
      refs: {
        1: { type: 'union' },
        2: { type: 'object', dict: { defaultPreset: 1 } },
      },
    }))).toThrow(/does not advertise/)
    expect(() => permissionDefaultOf(view('read-only', 0, {
      uid: 4,
      refs: {
        1: { type: 'string' },
        2: { type: 'const', value: 1 },
        3: { type: 'union', list: [1, 2] },
        4: { type: 'object', dict: { defaultPreset: 3 } },
      },
    }))).toThrow(/does not advertise/)
    expect(() => permissionDefaultOf(view('missing'))).toThrow(/does not advertise/)
  })

  it('loads and writes defaultPreset with optimistic concurrency', async () => {
    const describe = vi.fn(() => Promise.resolve(ok({
      writable: true,
      hasDocument: false,
      namespaces: [view('read-only', 4)],
    })))
    const mutate = vi.fn(() => Promise.resolve(ok(view('workspace-write', 5))))
    const controller = new PermissionPresetSettingsController({
      settings: { describe, mutate } as never,
    })
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      writable: true,
      currentValue: 'read-only',
      revision: 4,
    })
    await controller.select('workspace-write')
    expect(mutate).toHaveBeenCalledWith({
      ns: 'permission',
      ops: [{ op: 'set', path: ['defaultPreset'], value: 'workspace-write' }],
      expectedRevision: 4,
    })
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      currentValue: 'workspace-write',
      revision: 5,
    })
  })

  it('hides the row when the namespace is absent and contains write failures', async () => {
    const describe = vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [] })))
    const controller = new PermissionPresetSettingsController({
      settings: { describe, mutate: vi.fn() } as never,
    })
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('unavailable')

    const failing = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate: () => Promise.resolve({
          rpcId: 'test',
          result: {
            ok: false as const,
            error: { code: 'settings-conflict', message: 'stale', details: {} },
          },
        }),
      } as never,
    })
    await failing.load()
    await failing.select('workspace-write')
    expect(failing.store.getSnapshot()).toMatchObject({ status: 'error', error: 'stale' })
  })

  it('contains read failures, no-ops without a writable view, and ignores stale responses', async () => {
    const first = Promise.withResolvers<ReturnType<typeof ok<{
      writable: boolean
      namespaces: SettingsNamespaceView[]
    }>>>()
    const describe = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(ok({ writable: false, hasDocument: false, namespaces: [view('read-only', 2)] }))
    const mutate = vi.fn()
    const controller = new PermissionPresetSettingsController({
      settings: { describe, mutate } as never,
    })
    const stale = controller.load()
    await controller.load()
    first.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('workspace-write', 1)] }))
    await stale
    expect(controller.store.getSnapshot()).toMatchObject({
      currentValue: 'read-only',
      writable: false,
      revision: 2,
    })
    await controller.select('workspace-write')
    expect(mutate).not.toHaveBeenCalled()

    const rejected = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve({
          rpcId: 'test',
          result: { ok: false as const, error: { code: 'internal', message: 'offline', details: {} } },
        }),
        mutate,
      } as never,
    })
    await rejected.select('workspace-write')
    await rejected.load()
    expect(rejected.store.getSnapshot()).toMatchObject({ status: 'error', error: 'offline' })

    const thrown = new PermissionPresetSettingsController({
      settings: {
        // Promise consumers must contain unknown rejection values from a
        // transport implementation, including non-Error legacy clients.
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors
        describe: () => Promise.reject('disconnected'),
        mutate,
      } as never,
    })
    await thrown.load()
    expect(thrown.store.getSnapshot()).toMatchObject({ status: 'error', error: 'disconnected' })
  })

  it('disposal suppresses in-flight reads and writes, and loaded invalidations refetch', async () => {
    const read = Promise.withResolvers<ReturnType<typeof ok<{
      writable: boolean
      namespaces: SettingsNamespaceView[]
    }>>>()
    const describe = vi.fn(() => read.promise)
    const idle = new PermissionPresetSettingsController({ settings: { describe, mutate: vi.fn() } as never })
    refreshPermissionIfLoaded(idle)
    expect(describe).not.toHaveBeenCalled()
    const loading = idle.load()
    idle.dispose()
    read.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] }))
    await loading
    expect(idle.store.getSnapshot().status).toBe('loading')

    const rejectedRead = Promise.withResolvers<ReturnType<typeof ok<{
      writable: boolean
      namespaces: SettingsNamespaceView[]
    }>>>()
    const disposedRead = new PermissionPresetSettingsController({
      settings: { describe: () => rejectedRead.promise, mutate: vi.fn() } as never,
    })
    const reading = disposedRead.load()
    disposedRead.dispose()
    rejectedRead.reject(new Error('late read'))
    await reading
    expect(disposedRead.store.getSnapshot().status).toBe('loading')

    const mutation = Promise.withResolvers<ReturnType<typeof ok<SettingsNamespaceView>>>()
    const activeDescribe = vi.fn(() => Promise.resolve(ok({
      writable: true,
      hasDocument: false,
      namespaces: [view('read-only')],
    })))
    const active = new PermissionPresetSettingsController({
      settings: {
        describe: activeDescribe,
        mutate: () => mutation.promise,
      } as never,
    })
    await active.load()
    refreshPermissionIfLoaded(active)
    await vi.waitFor(() => { expect(activeDescribe).toHaveBeenCalledTimes(2) })
    const saving = active.select('workspace-write')
    active.dispose()
    mutation.resolve(ok(view('workspace-write', 1)))
    await saving
    expect(active.store.getSnapshot().status).toBe('saving')

    const rejectedMutation = Promise.withResolvers<ReturnType<typeof ok<SettingsNamespaceView>>>()
    const disposedWrite = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate: () => rejectedMutation.promise,
      } as never,
    })
    await disposedWrite.load()
    const writing = disposedWrite.select('workspace-write')
    disposedWrite.dispose()
    rejectedMutation.reject(new Error('late write'))
    await writing
    expect(disposedWrite.store.getSnapshot().status).toBe('saving')
  })
})
