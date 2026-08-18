import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { SettingsScopeController, SettingsScopeBinder } from '../src/client/settings-scope.ts'

interface UiTestSettings {
  preference: 'light' | 'dark' | 'system'
}

const ENVELOPE = z.object({
  preference: z.union(['light', 'dark', 'system']).default('system'),
}).toJSON()

let rpc = 0

function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `scope-${rpc++}` as never, result: { ok: true, value } }
}

function rejected<T>(): RpcResponse<T> {
  return {
    rpcId: `scope-${rpc++}` as never,
    result: {
      ok: false,
      error: { code: 'settings-rejected', message: 'conflict', details: { ns: 'ui-test' } },
    },
  }
}

function view(value: unknown, revision = 0): SettingsNamespaceView {
  return {
    ns: 'ui-test',
    schema: ENVELOPE,
    value,
    applies: 'live',
    secrets: [],
    revision,
  }
}

function described(value: unknown, revision = 0) {
  return ok({ writable: true, hasDocument: true, namespaces: [view(value, revision)] })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** Record each distinct published section, starting from the current one. */
function trackValues(scope: SettingsScope<UiTestSettings>): Array<UiTestSettings | undefined> {
  const seen: Array<UiTestSettings | undefined> = [scope.getSnapshot().value]
  scope.subscribe(() => {
    const value = scope.getSnapshot().value
    if (value !== seen[seen.length - 1]) seen.push(value)
  })
  return seen
}

describe('SettingsScopeController', () => {
  it('starts loading and publishes a schema-valid section with revision and writability', async () => {
    const describeCall = vi.fn().mockResolvedValueOnce(described({ preference: 'dark' }, 3))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall } } as never,
      { namespace: 'ui-test' },
    )
    expect(scope.getSnapshot()).toEqual({
      status: 'loading', value: undefined, revision: undefined, writable: false, mode: 'host',
    })
    await scope.load()
    expect(scope.getSnapshot()).toEqual({
      status: 'ready', value: { preference: 'dark' }, revision: 3, writable: true, mode: 'host',
    })
  })

  it('keeps the last good value across invalid, rejected, and failed reads while tracking revisions', async () => {
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'dark' }, 3))
      .mockResolvedValueOnce(described({ preference: 'sepia' }, 4))
      .mockResolvedValueOnce(described(null, 5))
      .mockResolvedValueOnce(described('scalar', 6))
      .mockResolvedValueOnce(described(['queue'], 7))
      .mockResolvedValueOnce(rejected())
      .mockRejectedValueOnce(new Error('offline'))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall } } as never,
      { namespace: 'ui-test' },
    )
    const good = trackValues(scope)
    for (let i = 0; i < 7; i++) await scope.load()
    expect(scope.getSnapshot()).toMatchObject({
      status: 'ready', value: { preference: 'dark' }, revision: 7,
    })
    expect(good).toEqual([undefined, { preference: 'dark' }])
  })

  it('treats a schema envelope it cannot rehydrate as vouching for no section', async () => {
    const broken = { ...view({ preference: 'dark' }, 2), schema: null }
    const describeCall = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces: [broken] }))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall } } as never,
      { namespace: 'ui-test' },
    )
    await scope.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'loading', value: undefined, revision: 2 })
  })

  it('suppresses a superseded read of an unexposed namespace', async () => {
    const describeCall = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces: [] }))
      .mockResolvedValueOnce(described({ preference: 'dark' }, 1))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall } } as never,
      { namespace: 'ui-test' },
    )
    const statuses: string[] = []
    scope.subscribe(() => { statuses.push(scope.getSnapshot().status) })
    const stale = scope.load()
    const fresh = scope.load()
    await Promise.all([stale, fresh])
    expect(statuses).not.toContain('unavailable')
    expect(scope.getSnapshot()).toMatchObject({ status: 'ready', value: { preference: 'dark' } })
  })

  it('reports an unexposed namespace as unavailable and recovers when it reappears', async () => {
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'light' }, 1))
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces: [] }))
      .mockResolvedValueOnce(described({ preference: 'system' }, 2))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall } } as never,
      { namespace: 'ui-test' },
    )
    await scope.load()
    expect(scope.getSnapshot().status).toBe('ready')
    await scope.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'unavailable', value: { preference: 'light' } })
    await scope.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'ready', value: { preference: 'system' }, revision: 2 })
  })

  it('applies a custom decode override in place of the wire schema', async () => {
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'light' }, 1))
      .mockResolvedValueOnce(described({ preference: 'dark' }, 2))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall } } as never,
      {
        namespace: 'ui-test',
        decode: section => (section as UiTestSettings).preference === 'dark'
          ? section as UiTestSettings
          : undefined,
      },
    )
    await scope.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'loading', value: undefined, revision: 1 })
    await scope.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'ready', value: { preference: 'dark' }, revision: 2 })
  })

  it('serializes rapid set writes, carries revisions, and publishes only the latest settlement', async () => {
    const first = deferred<RpcResponse<SettingsNamespaceView>>()
    const describeCall = vi.fn().mockResolvedValue(described({ preference: 'system' }, 4))
    const mutate = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(ok(view({ preference: 'light' }, 6)))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall, mutate } } as never,
      { namespace: 'ui-test' },
    )
    const published = trackValues(scope)
    await scope.load()
    const dark = scope.set('preference', 'dark')
    const light = scope.set('preference', 'light')
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    first.resolve(ok(view({ preference: 'dark' }, 5)))
    await Promise.all([dark, light])
    expect(published.map(section => section?.preference)).toEqual([undefined, 'system', 'light'])
    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'light' }, revision: 6 })
    expect(mutate).toHaveBeenNthCalledWith(1, {
      ns: 'ui-test',
      ops: [{ op: 'set', path: ['preference'], value: 'dark' }],
      expectedRevision: 4,
    })
    expect(mutate).toHaveBeenNthCalledWith(2, {
      ns: 'ui-test',
      ops: [{ op: 'set', path: ['preference'], value: 'light' }],
      expectedRevision: 5,
    })
  })

  it('recovers the latest rejected or thrown write from Host state', async () => {
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'system' }, 2))
      .mockResolvedValueOnce(described({ preference: 'light' }, 3))
    const mutate = vi.fn()
      .mockResolvedValueOnce(rejected())
      .mockRejectedValueOnce(new Error('offline'))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall, mutate } } as never,
      { namespace: 'ui-test' },
    )
    const published = trackValues(scope)
    await scope.set('preference', 'dark')
    await scope.set('preference', 'system')
    expect(published.map(section => section?.preference)).toEqual([undefined, 'system', 'light'])
  })

  it('does not recover superseded rejected or thrown writes', async () => {
    const describeCall = vi.fn()
    const mutate = vi.fn()
      .mockResolvedValueOnce(rejected())
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(ok(view({ preference: 'light' }, 3)))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall, mutate } } as never,
      { namespace: 'ui-test' },
    )
    const published = trackValues(scope)
    await Promise.all([
      scope.set('preference', 'dark'),
      scope.set('preference', 'system'),
      scope.set('preference', 'light'),
    ])
    expect(describeCall).not.toHaveBeenCalled()
    expect(published.map(section => section?.preference)).toEqual([undefined, 'light'])
  })

  it('keeps the write queue usable when a subscriber throws', async () => {
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'dark' }, 1))
      .mockResolvedValueOnce(described({ preference: 'light' }, 2))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall } } as never,
      { namespace: 'ui-test' },
    )
    let thrown = false
    scope.subscribe(() => {
      if (thrown) return
      thrown = true
      throw new Error('subscriber failed')
    })
    await expect(scope.load()).rejects.toThrow('subscriber failed')
    await expect(scope.load()).resolves.toBeUndefined()
    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'light' }, revision: 2 })
  })

  it('cancels queued and post-dispose writes while draining the in-flight mutation', async () => {
    const first = deferred<RpcResponse<SettingsNamespaceView>>()
    const mutate = vi.fn().mockReturnValue(first.promise)
    const describeCall = vi.fn()
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall, mutate } } as never,
      { namespace: 'ui-test' },
    )
    const published = trackValues(scope)
    const dark = scope.set('preference', 'dark')
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    const light = scope.set('preference', 'light')
    let stopped = false
    const stop = scope.dispose().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    first.resolve(ok(view({ preference: 'dark' }, 1)))
    await Promise.all([dark, light, stop])
    await scope.set('preference', 'system')
    await scope.load()
    expect(mutate).toHaveBeenCalledOnce()
    expect(describeCall).not.toHaveBeenCalled()
    expect(published).toEqual([undefined])
  })

  it('keeps a remote browser in memory mode without Host calls', async () => {
    const describeCall = vi.fn()
    const mutate = vi.fn()
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall, mutate } } as never,
      { namespace: 'ui-test' },
      'memory',
    )
    expect(scope.getSnapshot()).toEqual({
      status: 'unavailable', value: undefined, revision: undefined, writable: false, mode: 'memory',
    })
    await scope.load()
    await scope.set('preference', 'dark')
    await scope.dispose()
    expect(describeCall).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('carries the composition base and the user layer into the snapshot', async () => {
    const layered: SettingsNamespaceView = {
      ...view({ preference: 'dark' }, 3),
      base: { preference: 'system' },
      user: { preference: 'dark' },
    }
    const describeCall = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces: [layered] }))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall } } as never,
      { namespace: 'ui-test' },
    )

    await scope.load()

    expect(scope.getSnapshot()).toMatchObject({
      value: { preference: 'dark' },
      base: { preference: 'system' },
      user: { preference: 'dark' },
    })
  })

  it('reports an inherited field as absent from the user layer', async () => {
    const inherited: SettingsNamespaceView = { ...view({ preference: 'system' }, 1), base: { preference: 'system' } }
    const describeCall = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces: [inherited] }))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall } } as never,
      { namespace: 'ui-test' },
    )

    await scope.load()

    expect(scope.getSnapshot().user).toBeUndefined()
  })

  it('clears one field through an unset op fenced by the held revision', async () => {
    const mutate = vi.fn().mockResolvedValueOnce(ok(view({ preference: 'system' }, 4)))
    const describeCall = vi.fn().mockResolvedValueOnce(described({ preference: 'dark' }, 3))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall, mutate } } as never,
      { namespace: 'ui-test' },
    )
    await scope.load()

    await scope.unset('preference')

    expect(mutate).toHaveBeenCalledWith({
      ns: 'ui-test',
      ops: [{ op: 'unset', path: ['preference'] }],
      expectedRevision: 3,
    })
    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'system' }, revision: 4 })
  })

  it('recovers the Host state when the latest clear is refused', async () => {
    const mutate = vi.fn().mockResolvedValueOnce(rejected())
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'dark' }, 3))
      .mockResolvedValueOnce(described({ preference: 'light' }, 5))
    const scope = new SettingsScopeController<UiTestSettings>(
      { settings: { describe: describeCall, mutate } } as never,
      { namespace: 'ui-test' },
    )
    await scope.load()

    await scope.unset('preference')

    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'light' }, revision: 5 })
  })
})
describe('SettingsScopeBinder.bind', () => {
  it('subscribes before the initial read and converges to the latest queued invalidation', async () => {
    const initial = deferred<ReturnType<typeof described>>()
    const describeCall = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(described({ preference: 'light' }, 2))
      .mockResolvedValueOnce(described({ preference: 'system' }, 3))
    const ctx = new Context()
    ctx.provide('connection', {
      api: { settings: { describe: describeCall } },
      isLoopback: true,
    } as never)
    let scope!: SettingsScope<UiTestSettings>
    new TestRemote(ctx)
    await ctx.plugin(SettingsScopeBinder).await()
    const fiber = ctx.plugin({
      inject: ['connection', 'remote', 'settingsScope'],
      apply: (plugin: Context) => {
        scope = plugin.settingsScope.bind<UiTestSettings>({ namespace: 'ui-test' })
      },
    })
    await fiber.await()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledOnce() })
    ctx.remote.$dispatch('settings/document-updated', ['unrelated', 0])
    ctx.remote.$dispatch('settings/document-updated', ['ui-test', 0])
    ctx.emit('connection/reset')
    initial.resolve(described({ preference: 'dark' }, 1))
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(3) })
    await vi.waitFor(() => {
      expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'system' }, revision: 3 })
    })
    await fiber.dispose()
    ctx.remote.$dispatch('settings/document-updated', ['ui-test', 0])
    await Promise.resolve()
    expect(describeCall).toHaveBeenCalledTimes(3)
  })

  it('binds a remote browser in memory mode without starting a settings read', async () => {
    const describeCall = vi.fn()
    const ctx = new Context()
    ctx.provide('connection', {
      api: { settings: { describe: describeCall } },
      isLoopback: false,
    } as never)
    let scope!: SettingsScope<UiTestSettings>
    new TestRemote(ctx)
    await ctx.plugin(SettingsScopeBinder).await()
    const fiber = ctx.plugin({
      inject: ['connection', 'remote', 'settingsScope'],
      apply: (plugin: Context) => {
        scope = plugin.settingsScope.bind<UiTestSettings>({ namespace: 'ui-test' })
      },
    })
    await fiber.await()
    expect(scope.getSnapshot()).toMatchObject({ status: 'unavailable', mode: 'memory', writable: false })
    await fiber.dispose()
    expect(describeCall).not.toHaveBeenCalled()
  })
})
