import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  AnonymousEntries,
  createScope,
  NamedEntries,
  ScopedLayers,
  type Scope,
  type ScopeKey,
  type ScopeLayer,
} from '@deepseek-ai/dsh-scope'

class TestLayer implements ScopeLayer {
  readonly named: NamedEntries<number>
  readonly anonymous = new AnonymousEntries<string>()

  constructor(scope: ScopeKey | undefined) {
    this.named = new NamedEntries(name =>
      new Error(`${scope === undefined ? 'global' : 'scoped'} duplicate: ${name}`))
  }

  isEmpty(): boolean {
    return this.named.isEmpty() && this.anonymous.isEmpty()
  }
}

/** Mint one active scope for lifecycle tests. */
async function mintScope(ctx: Context, key: ScopeKey): Promise<Scope> {
  let scope!: Scope
  await ctx.plugin((inner: Context) => { scope = createScope(inner, key) })
  return scope
}

describe('NamedEntries', () => {
  it('owns duplicate diagnostics, lookup, insertion order, live iteration, and exact idempotent undo', () => {
    const duplicate = new Error('caller duplicate')
    const duplicateError = vi.fn(() => duplicate)
    const entries = new NamedEntries<number>(duplicateError)
    const undoA = entries.insert('a', 1)
    const values = entries.values()
    expect(values.next()).toEqual({ value: 1, done: false })
    const undoB = entries.insert('b', 2)

    expect([...values]).toEqual([2])
    expect([...entries.keys()]).toEqual(['a', 'b'])
    expect([...entries.entries()]).toEqual([['a', 1], ['b', 2]])
    expect(entries.get('a')).toBe(1)
    expect(entries.get('missing')).toBeUndefined()
    expect(entries.has('b')).toBe(true)
    expect(entries.has('missing')).toBe(false)
    expect(entries.isEmpty()).toBe(false)
    expect(() => entries.insert('a', 3)).toThrow(duplicate)
    expect(duplicateError).toHaveBeenCalledWith('a')

    undoA()
    entries.insert('a', 3)
    undoA()
    expect(entries.get('a')).toBe(3)
    undoB()
    expect([...entries.entries()]).toEqual([['a', 3]])
  })

  it('starts a fresh iterator generation after the table drains', () => {
    const entries = new NamedEntries<number>(name => new Error(`duplicate: ${name}`))
    const undo = entries.insert('first', 1)
    const values = entries.values()

    expect(values.next()).toEqual({ value: 1, done: false })
    undo()
    entries.insert('replacement', 2)

    expect(values.next().done).toBe(true)
    expect([...entries.values()]).toEqual([2])
  })
})

describe('AnonymousEntries', () => {
  it('owns equal values independently with live insertion-ordered iteration and idempotent undo', () => {
    const entries = new AnonymousEntries<object>()
    const value = {}
    const undoFirst = entries.append(value)
    const values = entries.values()
    expect(values.next()).toEqual({ value, done: false })
    const undoSecond = entries.append(value)

    expect([...values]).toEqual([value])
    expect([...entries.values()]).toEqual([value, value])
    undoFirst()
    undoFirst()
    expect([...entries.values()]).toEqual([value])
    undoSecond()
    expect(entries.isEmpty()).toBe(true)
  })

  it('starts a fresh iterator generation after the table drains', () => {
    const entries = new AnonymousEntries<number>()
    const undo = entries.append(1)
    const values = entries.values()

    expect(values.next()).toEqual({ value: 1, done: false })
    undo()
    entries.append(2)

    expect(values.next().done).toBe(true)
    expect([...entries.values()]).toEqual([2])
  })
})

describe('ScopedLayers', () => {
  it('constructs global state eagerly while reads stay non-creating and merge named shadows in order', () => {
    const created: Array<ScopeKey | undefined> = []
    const layers = new ScopedLayers(
      (scope) => {
        created.push(scope)
        return new TestLayer(scope)
      },
      vi.fn(),
    )
    const key = {}
    layers.global.named.insert('a', 1)
    layers.global.named.insert('shared', 2)

    expect(created).toEqual([undefined])
    expect(layers.peek(undefined)).toBeUndefined()
    expect(layers.peek(key)).toBeUndefined()
    expect([...layers.merge(key, layer => layer.named)]).toEqual([['a', 1], ['shared', 2]])
    expect(created).toEqual([undefined])
  })

  it('uses the same scoped context for lazy visibility and ownership, and reclaims only an empty aggregate', async () => {
    const ctx = new Context()
    const key = {}
    const scope = await mintScope(ctx, key)
    const changed = vi.fn()
    const created: Array<ScopeKey | undefined> = []
    const layers = new ScopedLayers(
      (selected) => {
        created.push(selected)
        return new TestLayer(selected)
      },
      changed,
    )
    layers.global.named.insert('a', 1)
    layers.global.named.insert('shared', 1)
    const removeNamed = layers.effect(
      scope.ctx,
      layer => layer.named.insert('shared', 2),
      { label: 'test.named', notify: false },
    )
    const removeTail = layers.effect(
      scope.ctx,
      layer => layer.named.insert('c', 3),
      { label: 'test.tail', notify: false },
    )
    const removeAnonymous = layers.effect(
      scope.ctx,
      layer => layer.anonymous.append('kept'),
      { label: 'test.anonymous', notify: false },
    )

    expect(created).toEqual([undefined, key])
    expect([...layers.merge(key, layer => layer.named)]).toEqual([['a', 1], ['shared', 2], ['c', 3]])
    expect(changed).not.toHaveBeenCalled()
    removeNamed()
    expect(layers.peek(key)).toBeDefined()
    expect([...layers.merge(key, layer => layer.named)]).toEqual([['a', 1], ['shared', 1], ['c', 3]])
    removeTail()
    expect(layers.peek(key)).toBeDefined()
    removeAnonymous()
    expect(layers.peek(key)).toBeUndefined()
    await scope.dispose()
  })

  it('runs action, notification, undo, and disposal notification in order with Cordis idempotence and labels', async () => {
    const ctx = new Context()
    const events: string[] = []
    const layers = new ScopedLayers(
      scope => new TestLayer(scope),
      () => void events.push('notify'),
    )
    const dispose = layers.effect(
      ctx,
      (layer) => {
        events.push('action')
        const undo = layer.named.insert('x', 1)
        return () => {
          events.push('undo')
          undo()
        }
      },
      { label: 'store.order' },
    )

    expect(events).toEqual(['action', 'notify'])
    expect(ctx.fiber.getEffects().map(effect => effect.label)).toContain('store.order')
    dispose()
    dispose()
    expect(events).toEqual(['action', 'notify', 'undo', 'notify'])
    expect(layers.global.isEmpty()).toBe(true)
  })

  it('returns the exact context effect disposer', () => {
    const rawDispose = vi.fn()
    const effect = vi.fn(() => rawDispose)
    const ctx = { effect } as unknown as Context
    const action = vi.fn(() => vi.fn())
    const layers = new ScopedLayers(scope => new TestLayer(scope), vi.fn())

    const returned = layers.effect(ctx, action, { label: 'store.identity', notify: false })

    expect(returned).toBe(rawDispose)
    expect(effect).toHaveBeenCalledWith(expect.any(Function), 'store.identity')
    expect(action).not.toHaveBeenCalled()
  })

  it('cleans up failed factories and empty failed actions without discarding an existing layer', async () => {
    const ctx = new Context()
    const key = {}
    const scope = await mintScope(ctx, key)
    let failFactory = true
    const layers = new ScopedLayers(
      (selected) => {
        if (selected !== undefined && failFactory) throw new Error('factory failed')
        return new TestLayer(selected)
      },
      vi.fn(),
    )

    expect(() => layers.effect(
      scope.ctx,
      layer => layer.named.insert('never', 1),
      { label: 'store.factory', notify: false },
    )).toThrow('factory failed')
    expect(layers.peek(key)).toBeUndefined()

    failFactory = false
    expect(() => layers.effect(
      scope.ctx,
      () => { throw new Error('action failed') },
      { label: 'store.action', notify: false },
    )).toThrow('action failed')
    expect(layers.peek(key)).toBeUndefined()

    const dispose = layers.effect(
      scope.ctx,
      layer => layer.named.insert('kept', 1),
      { label: 'store.kept', notify: false },
    )
    expect(() => layers.effect(
      scope.ctx,
      () => { throw new Error('second action failed') },
      { label: 'store.existing-action', notify: false },
    )).toThrow('second action failed')
    expect(layers.peek(key)?.named.get('kept')).toBe(1)
    dispose()
    await scope.dispose()
  })

  it('rolls back a scoped insertion when notification throws', async () => {
    const ctx = new Context()
    const key = {}
    const scope = await mintScope(ctx, key)
    const events: string[] = []
    let notifications = 0
    const layers = new ScopedLayers(
      selected => new TestLayer(selected),
      () => {
        events.push('notify')
        if (++notifications === 1) throw new Error('change failed')
      },
    )

    expect(() => layers.effect(
      scope.ctx,
      (layer) => {
        const undo = layer.named.insert('rollback', 1)
        return () => {
          events.push('undo')
          undo()
        }
      },
      { label: 'store.rollback' },
    )).toThrow('change failed')

    expect(events).toEqual(['notify', 'undo', 'notify'])
    expect(layers.peek(key)).toBeUndefined()
    await scope.dispose()
  })
})
