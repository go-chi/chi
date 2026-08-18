import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SettingsProvider, SettingsConflictError, deepEqualJson, installSettingsSection, settingsNamespace, type SettingsNamespace, type SettingsScope, type SettingsUpdateSource } from '../src/index.ts'
import { MemorySettings } from './memory.ts'

/** A provider implementing only the three primitives: the Service Definition owns initialization. */
class BareProvider extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

interface ThemeConfig {
  theme: 'dark' | 'light'
  fontSize: number
}

const ThemeSchema: z<ThemeConfig> = z.object({
  theme: z.union(['dark', 'light']).default('dark'),
  fontSize: z.number().default(14),
})

interface NestedConfig {
  retry: { attempts: number; delayMs: number }
  tags: string[]
}

const NestedSchema: z<NestedConfig> = z.object({
  retry: z.object({
    attempts: z.number().default(2),
    delayMs: z.number().default(100),
  }),
  tags: z.array(z.string()).default(['default']),
})

async function boot(options?: ConstructorParameters<typeof MemorySettings>[1]) {
  const ctx = new Context()
  const fiber = ctx.plugin(MemorySettings, options)
  await fiber
  const provider = ctx.get('settings') as MemorySettings
  return { ctx, provider, fiber }
}

describe('provider metadata', () => {
  it('does not advertise a local document unless the provider overrides it', async () => {
    const { ctx } = await boot()
    expect(ctx.settings.documentPath).toBeUndefined()
    await expect(ctx.settings.prepareDocument()).resolves.toBeUndefined()
  })
})

/** Record every settings/updated emission. */
function recordUpdates(ctx: Context) {
  const events: Array<{ ns: string; next: unknown; prev: unknown; source: SettingsUpdateSource }> = []
  ctx.on('settings/updated', (ns, next, prev, source) => {
    events.push({ ns, next, prev, source })
  })
  return events
}

describe('settingsNamespace', () => {
  it('brands lowercase kebab-case names', () => {
    expect(settingsNamespace('ui-theme')).toBe('ui-theme')
  })

  it.each(['', 'UI', '9lives', 'a_b', '-lead'])('rejects %j', (value) => {
    expect(() => settingsNamespace(value)).toThrow(TypeError)
  })
})

describe('registration', () => {
  it('resolves schema defaults, then composition base, then the user layer', async () => {
    const { ctx } = await boot({ doc: { 'ui-theme': { theme: 'light' } } })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema, {
      base: { fontSize: 16 },
    })
    // theme: user layer wins; fontSize: base wins over the schema default.
    expect(scope.get()).toEqual({ theme: 'light', fontSize: 16 })
  })

  it('refuses a write its owner could not act on, and keeps the last good value for a stored one', async () => {
    const { ctx } = await boot()
    const ns = settingsNamespace('ui-theme')
    // A constraint the schema cannot express: this owner cannot serve a size
    // it considers unreadable, whatever the schema admits.
    const scope = ctx.settings.register(ns, ThemeSchema, {
      validate: (value) => {
        if (value.fontSize < 10) throw new Error(`font size ${String(value.fontSize)} is unreadable`)
      },
    })
    const before = scope.get()

    await expect(ctx.settings.update(ns, { fontSize: 4 })).rejects.toThrow(/unreadable/)
    expect(scope.get()).toEqual(before)

    // An externally edited document must not strand the owner: the namespace
    // keeps its last good value, exactly as a schema failure would.
    ;(ctx.settings as unknown as { publish(doc: Record<string, unknown>): void })
      .publish({ 'ui-theme': { fontSize: 4 } })
    expect(scope.get()).toEqual(before)

    await ctx.settings.update(ns, { fontSize: 18 })
    expect(scope.get()).toMatchObject({ fontSize: 18 })
  })

  it('fails the registration itself when the already-stored section is unserviceable', async () => {
    // The other direction of the same contract: `register` resolves inline, so
    // at cold start there is no last good value to keep. A stored section the
    // owner cannot serve therefore refuses the registration rather than
    // mounting an owner over configuration it rejects.
    const { ctx } = await boot({ doc: { 'ui-theme': { fontSize: 4 } } })
    expect(() => ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema, {
      validate: (value) => {
        if (value.fontSize < 10) throw new Error(`font size ${String(value.fontSize)} is unreadable`)
      },
    })).toThrow(/unreadable/)
  })

  it('rejects a duplicate namespace loud', async () => {
    const { ctx } = await boot()
    ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    expect(() => ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema))
      .toThrow(/already registered/)
  })

  it('fails registration when the stored section is invalid for the schema', async () => {
    const { ctx } = await boot({ doc: { 'ui-theme': { fontSize: 'big' } } })
    expect(() => ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)).toThrow()
  })

  it('fails registration when the stored section is not an object', async () => {
    const { ctx } = await boot({ doc: { 'ui-theme': 'dark' } })
    expect(() => ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema))
      .toThrow(/must be an object/)
  })

  it('describes registered namespaces with schema JSON, value, and applies', async () => {
    const { ctx } = await boot()
    ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    ctx.settings.register(settingsNamespace('workspace'), NestedSchema, { applies: 'restart' })
    const descriptors = ctx.settings.describe()
    expect(descriptors.map(entry => [entry.ns, entry.applies])).toEqual([
      ['ui-theme', 'live'],
      ['workspace', 'restart'],
    ])
    expect(descriptors[0]!.value).toEqual({ theme: 'dark', fontSize: 14 })
    // schemastery's canonical wire form: a { uid, refs } envelope whose root ref
    // is the object schema — the shape schema-driven form UIs reconstruct from.
    const serialized = descriptors[0]!.schema as { uid: number; refs: Record<string, { type: string }> }
    expect(serialized.refs[String(serialized.uid)]?.type).toBe('object')
  })

  it('reads undefined for an unregistered namespace', async () => {
    const { ctx } = await boot()
    expect(ctx.settings.get(settingsNamespace('missing'))).toBeUndefined()
  })

  it('hands out frozen resolved values', async () => {
    const { ctx } = await boot({ doc: { workspace: { retry: { attempts: 5 } } } })
    const scope = ctx.settings.register(settingsNamespace('workspace'), NestedSchema)
    const value = scope.get()
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.retry)).toBe(true)
    expect(() => { (value.retry as { attempts: number }).attempts = 0 }).toThrow(TypeError)
  })

  it('removes the namespace and its observers when the registrant fiber disposes', async () => {
    const { ctx, provider } = await boot()
    const seen: unknown[] = []
    let scope: SettingsScope<ThemeConfig> | undefined
    const fiber = ctx.plugin({
      inject: ['settings'],
      apply: (child: Context) => {
        scope = child.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
        scope.watch((next) => { seen.push(next) })
      },
    })
    await fiber
    expect(ctx.settings.get(settingsNamespace('ui-theme'))).toEqual({ theme: 'dark', fontSize: 14 })

    await fiber.dispose()
    expect(ctx.settings.get(settingsNamespace('ui-theme'))).toBeUndefined()
    expect(ctx.settings.describe()).toEqual([])
    provider.pushExternal({ 'ui-theme': { theme: 'light' } })
    expect(seen).toEqual([])

    // The namespace is free again, and re-registration resolves the user layer
    // that kept living in storage while nobody owned the namespace.
    const again = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    expect(again.get()).toEqual({ theme: 'light', fontSize: 14 })
  })
})

describe('update', () => {
  it('persists the merged user section without baking in the base layer', async () => {
    const { ctx, provider } = await boot({ doc: { 'ui-theme': { theme: 'light' } } })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema, {
      base: { fontSize: 16 },
    })
    await scope.update({ theme: 'dark' })
    expect(provider.persisted).toEqual([
      { ns: 'ui-theme', section: { theme: 'dark' } },
    ])
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 16 })
  })

  it('deep-merges nested objects and replaces arrays wholesale', async () => {
    const { ctx, provider } = await boot({
      doc: { workspace: { retry: { attempts: 5, delayMs: 300 }, tags: ['a', 'b'] } },
    })
    const scope = ctx.settings.register(settingsNamespace('workspace'), NestedSchema)
    await scope.update({ retry: { attempts: 7 }, tags: ['c'] })
    expect(provider.persisted[0]!.section).toEqual({
      retry: { attempts: 7, delayMs: 300 },
      tags: ['c'],
    })
    expect(scope.get()).toEqual({ retry: { attempts: 7, delayMs: 300 }, tags: ['c'] })
  })

  it('commits, notifies watchers, and emits with source update', async () => {
    const { ctx } = await boot()
    const events = recordUpdates(ctx)
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    const watcher = vi.fn()
    scope.watch(watcher)
    await scope.update({ theme: 'light' })
    expect(watcher).toHaveBeenCalledWith(
      { theme: 'light', fontSize: 14 },
      { theme: 'dark', fontSize: 14 },
    )
    expect(events).toEqual([{
      ns: 'ui-theme',
      next: { theme: 'light', fontSize: 14 },
      prev: { theme: 'dark', fontSize: 14 },
      source: 'update',
    }])
  })

  it('rejects an invalid patch before persisting anything', async () => {
    const { ctx, provider } = await boot()
    const events = recordUpdates(ctx)
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await expect(scope.update({ fontSize: 'big' })).rejects.toThrow()
    expect(provider.persisted).toEqual([])
    expect(events).toEqual([])
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 14 })
    // The failed write must not poison the namespace queue for later writers.
    await scope.update({ fontSize: 18 })
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 18 })
  })

  it('ignores explicit undefined entries so a sparse patch cannot erase keys', async () => {
    const { ctx, provider } = await boot({ doc: { 'ui-theme': { theme: 'light' } } })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await scope.update({ theme: undefined, fontSize: 18 })
    expect(provider.persisted[0]!.section).toEqual({ theme: 'light', fontSize: 18 })
    expect(scope.get()).toEqual({ theme: 'light', fontSize: 18 })
  })

  it('rejects a non-object patch', async () => {
    const { ctx } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await expect(scope.update([1])).rejects.toThrow(TypeError)
    await expect(scope.update(new Date() as unknown as object)).rejects.toThrow(TypeError)
    await expect(scope.replace([1])).rejects.toThrow(/replace for "ui-theme"/)
  })

  it('accepts a null-prototype patch object', async () => {
    const { ctx } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    const patch: { fontSize?: number } = Object.create(null) as { fontSize?: number }
    patch.fontSize = 18
    await scope.update(patch)
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 18 })
  })

  it('rejects an unregistered namespace', async () => {
    const { ctx } = await boot()
    await expect(ctx.settings.update(settingsNamespace('missing'), {}))
      .rejects.toThrow(/not registered/)
  })

  it('rejects on a read-only provider before reaching persist', async () => {
    const { ctx, provider } = await boot({ writable: false })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await expect(scope.update({ theme: 'light' })).rejects.toThrow(/read-only/)
    expect(provider.persisted).toEqual([])
  })
})

describe('deepEqualJson', () => {
  it.each([
    [{ a: [1, 2] }, { a: [1, 2] }, true],
    [{ a: [1, 2] }, { a: [1] }, false],
    [{ a: [1] }, { a: { 0: 1 } }, false],
    [{ a: 1 }, { b: 1 }, false],
    [{ a: 1 }, {}, false],
    [{ a: null }, { a: null }, true],
    [{ a: null }, { a: {} }, false],
  ])('compares %j vs %j as %s', (a, b, equal) => {
    expect(deepEqualJson(a, b)).toBe(equal)
  })
})

describe('review regressions', () => {
  it('propagates an invariant-coded listener failure instead of containing it', async () => {
    const { ctx, provider } = await boot()
    ctx.on('settings/updated', () => {
      throw Object.assign(new Error('forged relation'), { code: 'INVARIANT' })
    })
    ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    expect(() => { provider.pushExternal({ 'ui-theme': { theme: 'light' } }) })
      .toThrow(/forged relation/)
  })

  it('serializes concurrent updates so neither patch is lost', async () => {
    const { ctx, provider } = await boot({ persistDelayMs: 10 })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await Promise.all([
      scope.update({ theme: 'light' }),
      scope.update({ fontSize: 20 }),
    ])
    expect(provider.doc['ui-theme']).toEqual({ theme: 'light', fontSize: 20 })
    expect(scope.get()).toEqual({ theme: 'light', fontSize: 20 })
  })

  it('contains a throwing settings/updated listener and keeps later commits alive', async () => {
    const { ctx, provider } = await boot()
    ctx.on('settings/updated', () => {
      throw new Error('listener boom')
    })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    expect(() => { provider.pushExternal({ 'ui-theme': { theme: 'light' } }) }).not.toThrow()
    expect(scope.get().theme).toBe('light')
    provider.pushExternal({ 'ui-theme': { theme: 'dark' } })
    expect(scope.get().theme).toBe('dark')
  })

  it('contains an async watcher rejection', async () => {
    const { ctx, provider } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    scope.watch(async () => {
      throw new Error('async watcher boom')
    })
    provider.pushExternal({ 'ui-theme': { theme: 'light' } })
    expect(scope.get().theme).toBe('light')
    // Give the rejected watcher promise a microtask turn; containment means
    // vitest observes no unhandled rejection out of this test.
    await new Promise(resolve => setTimeout(resolve, 10))
  })

  it('loads the provider document through the base init without provider boilerplate', async () => {
    const ctx = new Context()
    await ctx.plugin(BareProvider, { doc: { 'ui-theme': { fontSize: 7 } } })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 7 })
  })

  it('replaces the user section wholesale so overrides can be removed', async () => {
    const { ctx, provider } = await boot({ doc: { 'ui-theme': { theme: 'light', fontSize: 20 } } })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema, {
      base: { fontSize: 16 },
    })
    await scope.replace({ theme: 'light' })
    // fontSize override is gone: resolution falls back to the base layer.
    expect(scope.get()).toEqual({ theme: 'light', fontSize: 16 })
    expect(provider.doc['ui-theme']).toEqual({ theme: 'light' })
    await scope.replace({})
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 16 })
    expect(provider.doc['ui-theme']).toEqual({})
  })
})

describe('second review regressions', () => {
  it('runs every settings/updated listener even when an earlier one throws', async () => {
    const { ctx, provider } = await boot()
    ctx.on('settings/updated', () => {
      throw new Error('first listener boom')
    })
    const second = vi.fn()
    ctx.on('settings/updated', second)
    ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    provider.pushExternal({ 'ui-theme': { theme: 'light' } })
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('rejects an update queued after the registrant fiber disposed', async () => {
    const { ctx } = await boot()
    let scope: SettingsScope<ThemeConfig> | undefined
    const fiber = ctx.plugin({
      inject: ['settings'],
      apply: (child: Context) => {
        scope = child.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
      },
    })
    await fiber
    await fiber.dispose()
    await expect(scope!.update({ theme: 'light' })).rejects.toThrow(/disposed|not registered/)
  })

  it('does not notify a registrant disposed while its update was in flight', async () => {
    const { ctx, provider } = await boot({ persistDelayMs: 30 })
    const events = recordUpdates(ctx)
    let scope: SettingsScope<ThemeConfig> | undefined
    const watcher = vi.fn()
    const fiber = ctx.plugin({
      inject: ['settings'],
      apply: (child: Context) => {
        scope = child.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
        scope.watch(watcher)
      },
    })
    await fiber
    const pending = scope!.update({ theme: 'light' })
    await new Promise(resolve => setTimeout(resolve, 5))
    await fiber.dispose()
    await pending.catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(watcher).not.toHaveBeenCalled()
    expect(events).toEqual([])
    // The persist was already in flight, so storage keeps the write — but no
    // commit reached the disposed registration.
    expect(provider.doc['ui-theme']).toEqual({ theme: 'light' })
  })

  it('drains in-flight writes at service dispose and rejects later ones', async () => {
    const { ctx, provider, fiber } = await boot({ persistDelayMs: 20 })
    const service = ctx.settings
    const scope = service.register(settingsNamespace('ui-theme'), ThemeSchema)
    const pending = scope.update({ theme: 'light' })
    await new Promise(resolve => setTimeout(resolve, 5))
    await fiber.dispose()
    // The teardown drained the in-flight write before completing…
    await pending.catch(() => undefined)
    const persistedAtDispose = provider.persisted.length
    expect(persistedAtDispose).toBe(1)
    // …and afterwards nothing writes and new writes reject.
    await expect(service.update(settingsNamespace('ui-theme'), { theme: 'dark' }))
      .rejects.toThrow(/disposed|not registered/)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(provider.persisted.length).toBe(persistedAtDispose)
  })

  it('serializes invocations of one async watcher in commit order', async () => {
    const { ctx, provider } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    const applied: number[] = []
    let firstCall = true
    scope.watch(async (next) => {
      // The first (stale) invocation is slow; unserialised it would finish
      // last and clobber the newer applied state.
      const delay = firstCall ? 30 : 0
      firstCall = false
      await new Promise(resolve => setTimeout(resolve, delay))
      applied.push(next.fontSize)
    })
    provider.pushExternal({ 'ui-theme': { fontSize: 1 } })
    provider.pushExternal({ 'ui-theme': { fontSize: 2 } })
    await vi.waitFor(() => {
      expect(applied).toHaveLength(2)
    })
    expect(applied).toEqual([1, 2])
  })

  it('rejects a function value as not JSON-compatible', async () => {
    const { ctx } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    await expect(scope.update({ theme: () => 'dark' }))
      .rejects.toThrow(/JSON-compatible.*function at \$\.theme/)
  })

  it('rejects a write still queued when the service disposes', async () => {
    const { ctx, fiber } = await boot({ persistDelayMs: 20 })
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    const first = scope.update({ theme: 'light' })
    const second = scope.update({ fontSize: 20 })
    await new Promise(resolve => setTimeout(resolve, 5))
    await fiber.dispose()
    await first
    await expect(second).rejects.toThrow(/disposed before the queued/)
  })

  it('rejects a write still queued when the registrant disposes', async () => {
    const { ctx } = await boot({ persistDelayMs: 20 })
    let scope: SettingsScope<ThemeConfig> | undefined
    const fiber = ctx.plugin({
      inject: ['settings'],
      apply: (child: Context) => {
        scope = child.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
      },
    })
    await fiber
    const first = scope!.update({ theme: 'light' })
    const second = scope!.update({ fontSize: 20 })
    await new Promise(resolve => setTimeout(resolve, 5))
    await fiber.dispose()
    await first
    await expect(second).rejects.toThrow(/registration was disposed before the queued/)
  })

  it('snapshots the patch at call time so caller mutation cannot leak in', async () => {
    const { ctx } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    const patch = { fontSize: 18 }
    const pending = scope.update(patch)
    patch.fontSize = 99
    await pending
    expect(scope.get().fontSize).toBe(18)
  })
})

describe('publish', () => {
  it('notifies watchers of an external change with source provider', async () => {
    const { ctx, provider } = await boot()
    const events = recordUpdates(ctx)
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    const watcher = vi.fn()
    scope.watch(watcher)
    provider.pushExternal({ 'ui-theme': { theme: 'light' } })
    await vi.waitFor(() => {
      expect(watcher).toHaveBeenCalledWith(
        { theme: 'light', fontSize: 14 },
        { theme: 'dark', fontSize: 14 },
      )
    })
    expect(events[0]!.source).toBe('provider')
  })

  it('stays silent when the resolved value is deep-equal', async () => {
    const { ctx, provider } = await boot({ doc: { 'ui-theme': { theme: 'light' } } })
    const events = recordUpdates(ctx)
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    const watcher = vi.fn()
    scope.watch(watcher)
    provider.pushExternal({ 'ui-theme': { theme: 'light' } })
    expect(watcher).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })

  it('keeps the last good value for an invalid section while other namespaces commit', async () => {
    const { ctx, provider } = await boot()
    const events = recordUpdates(ctx)
    const theme = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    const workspace = ctx.settings.register(settingsNamespace('workspace'), NestedSchema)
    provider.pushExternal({
      'ui-theme': { fontSize: 'broken' },
      workspace: { retry: { attempts: 9 } },
    })
    expect(theme.get()).toEqual({ theme: 'dark', fontSize: 14 })
    expect(workspace.get()).toEqual({ retry: { attempts: 9, delayMs: 100 }, tags: ['default'] })
    expect(events.map(event => event.ns)).toEqual(['workspace'])
  })

  it('recovers from a bad section once storage turns valid again', async () => {
    const { ctx, provider } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    provider.pushExternal({ 'ui-theme': { fontSize: 'broken' } })
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 14 })
    provider.pushExternal({ 'ui-theme': { fontSize: 18 } })
    expect(scope.get()).toEqual({ theme: 'dark', fontSize: 18 })
  })
})

describe('third review regressions', () => {
  it('skips a queued watch invocation whose disposer ran before it started', async () => {
    const { ctx, provider } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    const watcher = vi.fn()
    const dispose = scope.watch(watcher)
    // The commit chains the invocation as a microtask; the disposer runs in
    // the same synchronous frame, before that invocation could start.
    provider.pushExternal({ 'ui-theme': { theme: 'light' } })
    dispose()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(watcher).not.toHaveBeenCalled()
  })

  it('waits for an in-flight watch invocation at service dispose', async () => {
    const { ctx, provider, fiber } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    let release: (() => void) | undefined
    let finished = false
    scope.watch(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      finished = true
    })
    provider.pushExternal({ 'ui-theme': { theme: 'light' } })
    await vi.waitFor(() => { expect(release).toBeDefined() })
    let disposed = false
    const disposal = fiber.dispose().then(() => { disposed = true })
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(disposed).toBe(false)
    release!()
    await disposal
    expect(finished).toBe(true)
  })

  it('rejects a Date at its path before anything persists', async () => {
    const { ctx, provider } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), z.object({ value: z.any() }))
    await expect(scope.update({ value: { at: new Date(0) } }))
      .rejects.toThrow(/JSON-compatible.*Date at \$\.value\.at/)
    expect(provider.persisted).toEqual([])
  })

  it.each([
    ['a Map', { value: new Map() }, /Map at \$\.value/],
    ['a bigint', { value: [10n] }, /bigint at \$\.value\[0\]/],
    ['a symbol', { value: Symbol('x') }, /symbol at \$\.value/],
    ['a non-finite number', { value: Number.NaN }, /non-finite number at \$\.value/],
    ['an undefined array entry', { value: [undefined] }, /undefined at \$\.value\[0\]/],
    ['a class instance', { value: Object.create({ marker: true }) as object }, /non-plain object at \$\.value/],
  ])('rejects %s that structuredClone would admit', async (_label, patch, message) => {
    const { ctx } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), z.object({ value: z.any() }))
    await expect(scope.update(patch)).rejects.toThrow(message)
  })

  it('rejects a circular patch instead of storing an alias-looped document', async () => {
    const { ctx } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), z.object({ value: z.any() }))
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    await expect(scope.update({ value: cyclic })).rejects.toThrow(/circular reference at \$\.value\.self/)
    const loop: unknown[] = []
    loop.push(loop)
    await expect(scope.update({ value: loop })).rejects.toThrow(/circular reference at \$\.value\[0\]/)
  })

  it('accepts one object referenced twice without a cycle', async () => {
    const { ctx } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), z.object({ value: z.any() }))
    const shared = { leaf: 1 }
    await scope.update({ value: { left: shared, right: shared } })
    expect(scope.get()).toEqual({ value: { left: { leaf: 1 }, right: { leaf: 1 } } })
  })

  it('contains an async settings/updated listener rejection and keeps other listeners running', async () => {
    const { ctx, provider } = await boot()
    // An async listener violates the event's synchronous signature, but an
    // unlinted JS plugin can still register one. Declaring the return as
    // unknown keeps this file's typed surface legal (unknown-returning
    // functions are assignable to void positions) while the runtime value is
    // still the rejected promise the containment guard must handle.
    const boom = (): unknown => Promise.reject(new Error('async listener boom'))
    ctx.on('settings/updated', boom)
    const second = vi.fn()
    ctx.on('settings/updated', second)
    ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    provider.pushExternal({ 'ui-theme': { theme: 'light' } })
    expect(second).toHaveBeenCalledTimes(1)
    // Containment gives the rejection a handler; vitest observes no unhandled
    // rejection out of this test.
    await new Promise(resolve => setTimeout(resolve, 10))
  })
})

describe('watch', () => {
  it('stops after its disposer runs', async () => {
    const { ctx, provider } = await boot()
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    const watcher = vi.fn()
    const dispose = scope.watch(watcher)
    dispose()
    provider.pushExternal({ 'ui-theme': { theme: 'light' } })
    expect(watcher).not.toHaveBeenCalled()
  })

  it('contains a throwing watcher without blocking the commit or other watchers', async () => {
    const { ctx, provider } = await boot()
    const events = recordUpdates(ctx)
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    scope.watch(() => { throw new Error('watcher boom') })
    const second = vi.fn()
    scope.watch(second)
    provider.pushExternal({ 'ui-theme': { theme: 'light' } })
    await vi.waitFor(() => {
      expect(second).toHaveBeenCalledTimes(1)
    })
    expect(events).toHaveLength(1)
    expect(scope.get()).toEqual({ theme: 'light', fontSize: 14 })
  })
})

describe('installSettingsSection', () => {
  const HelperSchema: z<{ theme: string }> = z.object({
    theme: z.string().default('default'),
  })

  it('drives the source through attach, live commits, and detach', async () => {
    const ctx = new Context()
    const entry = { theme: 'entry' }
    let current: () => { theme: string } = () => entry
    let changes = 0
    installSettingsSection(ctx, settingsNamespace('helper-ns'), HelperSchema, entry, {
      setSource: (source) => {
        current = source
      },
      onChange: () => {
        changes += 1
      },
    })
    // No settings service mounted: nothing ran, the entry stays authoritative.
    expect(current()).toEqual({ theme: 'entry' })
    expect(changes).toBe(0)

    const fiber = ctx.plugin(MemorySettings, { doc: { 'helper-ns': { theme: 'user' } } })
    await fiber
    await vi.waitFor(() => {
      expect(current()).toEqual({ theme: 'user' })
    })
    expect(changes).toBe(1)

    await ctx.settings.update(settingsNamespace('helper-ns'), { theme: 'live' })
    await vi.waitFor(() => {
      expect(changes).toBe(2)
    })
    expect(current()).toEqual({ theme: 'live' })

    await fiber.dispose()
    await vi.waitFor(() => {
      expect(changes).toBe(3)
    })
    expect(current()).toEqual({ theme: 'entry' })
  })

  it('stays silent when the consumer itself unloads', async () => {
    const { ctx } = await boot({ doc: { 'helper-ns': { theme: 'user' } } })
    const entry = { theme: 'entry' }
    let current: () => { theme: string } = () => entry
    const changes: string[] = []
    const consumer = ctx.plugin({
      inject: ['settings'],
      apply: (child: Context) => {
        installSettingsSection(child, settingsNamespace('helper-ns'), HelperSchema, entry, {
          setSource: (source) => {
            current = source
          },
          onChange: () => {
            changes.push(current().theme)
          },
        })
      },
    })
    await consumer
    await vi.waitFor(() => {
      expect(changes).toEqual(['user'])
    })

    // The consumer's own teardown must not re-derive anything: an onChange
    // here would re-register routes and touch resources being released.
    await consumer.dispose()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(changes).toEqual(['user'])
  })

  it('stays silent for a stored change that lands while the consumer unloads', async () => {
    // The watcher outlives the start of teardown by the width of the unload,
    // so a document change arriving in that window reaches it. Notifying then
    // is exactly as harmful as notifying from the disposer.
    const { ctx, provider } = await boot({ doc: { 'helper-ns': { theme: 'user' } } })
    const entry = { theme: 'entry' }
    let current: () => { theme: string } = () => entry
    const changes: string[] = []
    const consumer = ctx.plugin({
      inject: ['settings'],
      apply: (child: Context) => {
        installSettingsSection(child, settingsNamespace('helper-ns'), HelperSchema, entry, {
          setSource: (source) => {
            current = source
          },
          onChange: () => {
            changes.push(current().theme)
          },
        })
      },
    })
    await consumer
    await vi.waitFor(() => {
      expect(changes).toEqual(['user'])
    })

    const unloading = consumer.dispose()
    provider.pushExternal({ 'helper-ns': { theme: 'racing' } })
    await unloading
    expect(changes).toEqual(['user'])
  })
})

describe('mutate (path-addressed writes)', () => {
  interface KeyedConfig {
    apiKey: string
    baseURL: string
    reasoning: string
  }

  const KeyedSchema: z<KeyedConfig> = z.object({
    apiKey: z.string().role('secret'),
    baseURL: z.string(),
    reasoning: z.string(),
  })

  const KEYED = settingsNamespace('keyed')
  const NESTED = settingsNamespace('workspace')

  async function mounted(doc: Record<string, unknown>) {
    const ctx = new Context()
    await ctx.plugin(BareProvider, { doc })
    ctx.settings.register(KEYED, KeyedSchema)
    return ctx
  }

  it('removes one field without touching a secret the caller never saw', async () => {
    // The data-loss shape this exists to prevent: a configuration UI reads the
    // REDACTED descriptor (no apiKey), the user resets baseURL, and the client
    // rebuilds the section from what it holds. A wholesale replace of that
    // rebuild deletes the stored literal key; a path unset cannot.
    const ctx = await mounted({ keyed: { apiKey: 'sk-stored', baseURL: 'https://user', reasoning: 'high' } })
    const redacted = ctx.settings.describe({ redactSecrets: true }).find(d => d.ns === KEYED)!
    expect(redacted.user).toEqual({ baseURL: 'https://user', reasoning: 'high' })

    await ctx.settings.mutate(KEYED, [{ op: 'unset', path: ['baseURL'] }])

    const raw = ctx.settings.describe().find(d => d.ns === KEYED)!
    expect(raw.user).toEqual({ apiKey: 'sk-stored', reasoning: 'high' })
  })

  it('applies set and unset in one write, in order', async () => {
    const ctx = await mounted({ keyed: { apiKey: 'sk-stored', baseURL: 'https://old' } })
    await ctx.settings.mutate(KEYED, [
      { op: 'set', path: ['baseURL'], value: 'https://new' },
      { op: 'set', path: ['reasoning'], value: 'low' },
      { op: 'unset', path: ['reasoning'] },
    ])
    expect(ctx.settings.describe().find(d => d.ns === KEYED)!.user)
      .toEqual({ apiKey: 'sk-stored', baseURL: 'https://new' })
  })

  it('reads the section as it stands at the front of the queue, not at call time', async () => {
    // Two concurrent writers: the mutate is issued against the pre-update
    // section but must observe the update that ran before it.
    const ctx = await mounted({ keyed: { apiKey: 'sk-stored' } })
    const first = ctx.settings.update(KEYED, { baseURL: 'https://first', reasoning: 'high' })
    const second = ctx.settings.mutate(KEYED, [{ op: 'unset', path: ['reasoning'] }])
    await Promise.all([first, second])
    expect(ctx.settings.describe().find(d => d.ns === KEYED)!.user)
      .toEqual({ apiKey: 'sk-stored', baseURL: 'https://first' })
  })

  it('creates intermediate objects for a nested set and leaves an absent unset alone', async () => {
    const ctx = new Context()
    await ctx.plugin(BareProvider, { doc: {} })
    ctx.settings.register(NESTED, NestedSchema)
    await ctx.settings.mutate(NESTED, [{ op: 'set', path: ['retry', 'attempts'], value: 5 }])
    expect(ctx.settings.describe().find(d => d.ns === NESTED)!.user).toEqual({ retry: { attempts: 5 } })
    await ctx.settings.mutate(NESTED, [{ op: 'unset', path: ['missing', 'deep'] }])
    expect(ctx.settings.describe().find(d => d.ns === NESTED)!.user).toEqual({ retry: { attempts: 5 } })
  })

  it('edits one leaf of an existing nested object without replacing its siblings', async () => {
    const ctx = new Context()
    await ctx.plugin(BareProvider, { doc: { workspace: { retry: { attempts: 5, delayMs: 250 } } } })
    ctx.settings.register(NESTED, NestedSchema)
    await ctx.settings.mutate(NESTED, [{ op: 'set', path: ['retry', 'delayMs'], value: 900 }])
    expect(ctx.settings.describe().find(d => d.ns === NESTED)!.user)
      .toEqual({ retry: { attempts: 5, delayMs: 900 } })
  })

  it('addresses the section itself through the empty path', async () => {
    const ctx = await mounted({ keyed: { apiKey: 'sk-stored', baseURL: 'https://user' } })
    await ctx.settings.mutate(KEYED, [{ op: 'set', path: [], value: { reasoning: 'low' } }])
    expect(ctx.settings.describe().find(d => d.ns === KEYED)!.user).toEqual({ reasoning: 'low' })
    await ctx.settings.mutate(KEYED, [{ op: 'unset', path: [] }])
    expect(ctx.settings.describe().find(d => d.ns === KEYED)!.user).toEqual({})
  })

  it('refuses a non-object at the section root, leaving the stored section alone', async () => {
    const ctx = await mounted({ keyed: { apiKey: 'sk-stored' } })
    await expect(ctx.settings.mutate(KEYED, [{ op: 'set', path: [], value: 'a whole section' }]))
      .rejects.toThrow(/setting the section root requires a plain object/)
    expect(ctx.settings.describe().find(d => d.ns === KEYED)!.user).toEqual({ apiKey: 'sk-stored' })
  })

  it('rejects ops that are not an array at all', async () => {
    const ctx = await mounted({ keyed: { apiKey: 'sk-stored' } })
    await expect(ctx.settings.mutate(KEYED, { op: 'unset', path: ['apiKey'] } as never))
      .rejects.toThrow(/must be an array of path ops/)
    expect(ctx.settings.describe().find(d => d.ns === KEYED)!.user).toEqual({ apiKey: 'sk-stored' })
  })

  it('rejects a malformed op before anything is queued', async () => {
    const ctx = await mounted({ keyed: { apiKey: 'sk-stored' } })
    await expect(ctx.settings.mutate(KEYED, [{ op: 'delete' } as never]))
      .rejects.toThrow(/must be \{op:'set'\|'unset', path\}/)
    await expect(ctx.settings.mutate(KEYED, [{ op: 'unset', path: ['a', 1] as never }]))
      .rejects.toThrow(/op paths must be arrays of strings/)
    expect(ctx.settings.describe().find(d => d.ns === KEYED)!.user).toEqual({ apiKey: 'sk-stored' })
  })

  it('rejects a value that lossless JSON cannot represent', async () => {
    const ctx = await mounted({ keyed: {} })
    await expect(ctx.settings.mutate(KEYED, [{ op: 'set', path: ['baseURL'], value: new Date() }]))
      .rejects.toThrow(/must contain only JSON-compatible data/)
  })
})

describe('revision and conflict detection', () => {
  const REV = settingsNamespace('rev')
  const RevSchema: z<{ a: string; b: string }> = z.object({
    a: z.string().default('base-a'),
    b: z.string(),
  })

  async function mounted(doc: Record<string, unknown> = {}) {
    const ctx = new Context()
    await ctx.plugin(BareProvider, { doc })
    return ctx
  }

  it('refuses a write whose expected revision is stale, leaving the winner in place', async () => {
    // Two editors open the same namespace, both holding revision 0. The first
    // to land wins; the second must be told rather than overwrite it.
    const ctx = await mounted()
    ctx.settings.register(REV, RevSchema)
    const opened = ctx.settings.describe().find(d => d.ns === REV)!.revision

    await ctx.settings.update(REV, { b: 'from-tab-B' }, opened)
    await expect(ctx.settings.update(REV, { a: 'from-tab-A' }, opened))
      .rejects.toThrow(/changed since it was read \(expected revision 0, now 1\)/)
    expect(ctx.settings.describe().find(d => d.ns === REV)!.user).toEqual({ b: 'from-tab-B' })
  })

  it('carries the machine code and both revisions on the refusal', async () => {
    const ctx = await mounted()
    ctx.settings.register(REV, RevSchema)
    await ctx.settings.update(REV, { b: 'first' })
    const error = await ctx.settings.update(REV, { b: 'second' }, 0).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SettingsConflictError)
    expect(error).toMatchObject({ code: 'SETTINGS_CONFLICT', expected: 0, actual: 1 })
  })

  it('accepts a write that carries no expectation at all', async () => {
    const ctx = await mounted()
    ctx.settings.register(REV, RevSchema)
    await ctx.settings.update(REV, { b: 'one' })
    await ctx.settings.update(REV, { b: 'two' })
    expect(ctx.settings.describe().find(d => d.ns === REV)!.revision).toBe(2)
  })

  it('announces a raw change whose resolved value is unchanged', async () => {
    // Storing an override equal to the schema default leaves `value` alone but
    // changes what the document says: the field is now overridden, not
    // inherited, and another tab has to learn that.
    const ctx = await mounted()
    ctx.settings.register(REV, RevSchema)
    const documents: Array<[string, number]> = []
    const resolved: string[] = []
    ctx.on('settings/document-updated', (ns, revision) => { documents.push([String(ns), revision]) })
    ctx.on('settings/updated', (ns) => { resolved.push(String(ns)) })

    await ctx.settings.update(REV, { a: 'base-a' })

    expect(documents).toEqual([['rev', 1]])
    expect(resolved).toEqual([])
    expect(ctx.settings.describe().find(d => d.ns === REV)!.user).toEqual({ a: 'base-a' })
  })

  it('does not move the revision when a write stores an identical section', async () => {
    const ctx = await mounted({ rev: { b: 'same' } })
    ctx.settings.register(REV, RevSchema)
    const documents: unknown[] = []
    ctx.on('settings/document-updated', (ns, revision) => { documents.push([String(ns), revision]) })
    await ctx.settings.update(REV, { b: 'same' })
    expect(documents).toEqual([])
    expect(ctx.settings.describe().find(d => d.ns === REV)!.revision).toBe(0)
  })

  it('moves the revision for an external edit the provider publishes', async () => {
    const ctx = await mounted()
    ctx.settings.register(REV, RevSchema)
    const documents: Array<[string, number]> = []
    ctx.on('settings/document-updated', (ns, revision) => { documents.push([String(ns), revision]) })
    ;(ctx.settings as unknown as { publish(doc: Record<string, unknown>): void })
      .publish({ rev: { b: 'edited on disk' } })
    expect(documents).toEqual([['rev', 1]])
    // An editor that opened before the external edit is now refused.
    await expect(ctx.settings.update(REV, { b: 'stale' }, 0)).rejects.toThrow(SettingsConflictError)
  })

  it('moves the revision past a stored section that was not an object', async () => {
    // A hand-edited file can leave a namespace holding a scalar. The resolved
    // value keeps its last good reading, and the repair that follows still has
    // to announce itself — an open editor is reading a document it cannot see.
    const ctx = await mounted()
    ctx.settings.register(REV, RevSchema)
    const settings = ctx.settings as unknown as { publish(doc: Record<string, unknown>): void }
    settings.publish({ rev: 'not a section' })
    const documents: Array<[string, number]> = []
    ctx.on('settings/document-updated', (ns, revision) => { documents.push([String(ns), revision]) })
    settings.publish({ rev: { b: 'repaired by hand' } })
    expect(documents).toEqual([['rev', 1]])
  })

  it('contains a throwing document listener and keeps the rest of the fan-out running', async () => {
    const ctx = await mounted()
    ctx.settings.register(REV, RevSchema)
    const seen: number[] = []
    ctx.on('settings/document-updated', () => { throw new Error('document listener boom') })
    ctx.on('settings/document-updated', (_ns, revision) => { seen.push(revision) })
    await ctx.settings.update(REV, { b: 'one' })
    await ctx.settings.update(REV, { b: 'two' })
    expect(seen).toEqual([1, 2])
  })

  it('contains an async document listener rejection', async () => {
    const ctx = await mounted()
    ctx.settings.register(REV, RevSchema)
    // Same shape as the `settings/updated` case above: the unknown return type
    // keeps an async listener legal at this file's typed surface while the
    // runtime value stays the rejected promise the containment guard handles.
    const boom = (): unknown => Promise.reject(new Error('async document boom'))
    ctx.on('settings/document-updated', boom)
    await ctx.settings.update(REV, { b: 'one' })
    expect(ctx.settings.describe().find(d => d.ns === REV)!.revision).toBe(1)
    // Give the rejected listener promise a microtask turn; containment means
    // vitest observes no unhandled rejection out of this test.
    await new Promise(resolve => setTimeout(resolve, 10))
  })

  it('propagates an invariant-coded document listener failure instead of containing it', async () => {
    const ctx = await mounted()
    ctx.settings.register(REV, RevSchema)
    ctx.on('settings/document-updated', () => {
      throw Object.assign(new Error('forged revision'), { code: 'INVARIANT' })
    })
    expect(() => {
      (ctx.settings as unknown as { publish(doc: Record<string, unknown>): void })
        .publish({ rev: { b: 'edited on disk' } })
    }).toThrow(/forged revision/)
  })
})
