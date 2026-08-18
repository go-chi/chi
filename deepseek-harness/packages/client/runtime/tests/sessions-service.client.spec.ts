/**
 * SessionRuntime: list store projection (manager → {ids, byId, current}
 * with derived titles), the migrated current-selection account (open
 * validation, persisted mask semantics, cell resolution), scope-tree
 * lifecycle (lazy mint / frozen survival / removed teardown with staged
 * deferral — the stage follows list.current), binding identity, breadcrumb
 * projection, create.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { SessionCreateError, SessionRuntime, scopeOf } from '../src/client/sessions/service.ts'
import { FakeApiClient, deferred, err, fakeRemote, ok } from './fake-api.client.ts'

const sid = (s: string): SessionId => s as SessionId

interface Bench {
  ctx: Context
  api: FakeApiClient
  svc: SessionRuntime
}

function bench(): Bench {
  const ctx = new Context()
  const api = new FakeApiClient()
  const svc = new SessionRuntime(ctx, api, fakeRemote())
  return { ctx, api, svc }
}

/** Refresh the manager list from programmable rows and flush the microtask batch. */
type FeedRow = {
  id: string
  cwd?: string
  parentId?: string
  origin?: 'subagent'
  running?: boolean
  blank?: boolean
  agentPreset?: string
}

async function feedList(b: Bench, rows: FeedRow[]): Promise<void> {
  b.api.onList = () => Promise.resolve(ok({
    items: rows.map(r => ({
      sessionId: sid(r.id), updatedAt: 1, running: r.running ?? false, blank: r.blank ?? false,
      ...(r.cwd !== undefined ? { cwd: r.cwd } : {}),
      ...(r.parentId !== undefined ? { parentSessionId: sid(r.parentId) } : {}),
      ...(r.origin !== undefined ? { origin: r.origin } : {}),
      ...(r.agentPreset !== undefined ? { agentPreset: r.agentPreset } : {}),
    })),
  }) as never)
  await b.svc.refresh()
  await Promise.resolve() // manager notifier flush
}

describe('list store projection', () => {
  it('projects durable titles separately from cwd/id display fallbacks and parent links', async () => {
    const b = bench()
    b.svc.handleMuxEnvelope({
      rpcId: 'title' as never,
      payload: { type: 'session/projection', sessionId: sid('s1'), key: 'title', value: 'Durable title', seq: 2 } as never,
    })
    await feedList(b, [
      { id: 's1', cwd: '/home/u/proj-a/' },
      { id: 's2', parentId: 's1', origin: 'subagent', running: true },
    ])
    const state = b.svc.list.getSnapshot()
    expect(state.ids).toEqual(['s1', 's2'])
    expect(state.byId[sid('s1')]).toMatchObject({ title: 'Durable title', displayTitle: 'Durable title', cwd: '/home/u/proj-a/' })
    expect(state.byId[sid('s2')]).toMatchObject({
      displayTitle: 's2', parentId: 's1', origin: 'subagent', running: true,
    })
    expect(state.byId[sid('s2')]?.title).toBeUndefined()
  })

  it('reprojects a blank session whose composition switched and nothing else moved', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1', blank: true, agentPreset: 'standard' }])
    expect(b.svc.list.getSnapshot().byId[sid('s1')]?.agentPreset).toBe('standard')

    // A confirmed switch moves the preset alone: the row keeps its updatedAt,
    // title, running, and blank bits, so an identity guard blind to the preset
    // would serve the old row forever — and every reader (the hero chip's own
    // no-op check, the header label) would keep the composition it replaced.
    b.svc.noteAgentPreset(sid('s1'), 'minimal')
    await Promise.resolve()

    expect(b.svc.list.getSnapshot().byId[sid('s1')]?.agentPreset).toBe('minimal')
  })

  it('reflects live increments (host stream via manager) into the store', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    b.svc.handleHostEnvelope({ rpcId: 'r1' as never, payload: { type: 'host/session-added', blank: true, sessionId: sid('s2') } as never })
    await Promise.resolve()
    expect(b.svc.list.getSnapshot().ids).toContain('s2')
  })
})

describe('search', () => {
  it('delegates transient content search without changing the list snapshot', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    const before = b.svc.list.getSnapshot()
    b.api.onSearch = () => Promise.resolve(ok({
      items: [{ sessionId: sid('s1'), snippet: 'matching excerpt' }],
      hasMore: false,
    }))
    const signal = new AbortController().signal

    await expect(b.svc.search('needle', signal)).resolves.toEqual({
      ok: true,
      value: {
        items: [{ sessionId: 's1', snippet: 'matching excerpt' }],
        hasMore: false,
      },
    })
    expect(b.api.lastSearchSignal).toBe(signal)
    expect(b.svc.list.getSnapshot()).toBe(before)
  })
})

describe('scope tree', () => {
  it('mints lazily on first resolution, tags the ctx, and keeps binding identity stable', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    expect(b.svc.scope(sid('unknown'))).toBeUndefined()
    const scoped = b.svc.scope(sid('s1'))
    expect(scoped).toBeDefined()
    expect(scopeOf(scoped as Context)).toBe('s1')
    expect(scopeOf(b.ctx)).toBeUndefined()
    const binding = b.svc.binding(sid('s1'))
    b.svc.open(sid('s1'))
    expect(binding?.session).toBe(b.svc.currentProvideInfo.getSnapshot().hooks['session'])
    expect(b.svc.binding(sid('s1'))).toBe(binding)
    expect(binding?.ctx).toBe(scoped)
  })

  it('tears down an off-stage removed session but defers the staged one until the stage moves', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }, { id: 's2' }])
    const ctx1 = b.svc.scope(sid('s1'))
    b.svc.open(sid('s1')) // s1 staged (current)
    b.svc.scope(sid('s2')) // s2 scoped but off stage

    await feedList(b, [{ id: 's1' }]) // s2 removed, off stage: torn down
    expect(b.svc.scope(sid('s2'))).toBeUndefined()

    await feedList(b, []) // s1 removed while staged (current masks): deferred, scope survives
    expect(b.svc.scope(sid('s1'))).toBe(ctx1)

    await feedList(b, [{ id: 's3' }])
    b.svc.open(sid('s3')) // stage moves: deferred teardown sweeps s1
    expect(b.svc.scope(sid('s1'))).toBeUndefined()
  })

  it('keeps the scope when the session merely stops running (frozen ≠ removed)', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1', running: true }])
    const scoped = b.svc.scope(sid('s1'))
    await feedList(b, [{ id: 's1', running: false }])
    expect(b.svc.scope(sid('s1'))).toBe(scoped)
  })

  it('cancels a deferred teardown when the id reappears in the list', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    const scoped = b.svc.scope(sid('s1'))
    b.svc.open(sid('s1'))
    await feedList(b, []) // removed while staged → deferred
    await feedList(b, [{ id: 's1' }, { id: 's2' }]) // reappears (current resurfaces, stage unchanged)
    b.svc.open(sid('s2')) // stage moves; sweep must NOT tear down the re-listed s1
    expect(b.svc.scope(sid('s1'))).toBe(scoped)
  })
})

describe('current selection (migrated from ui-layout, arbitrated into the list snapshot)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('open() writes list.current; unknown ids fail loud', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    expect(b.svc.list.getSnapshot().current).toBeUndefined()
    b.svc.open(sid('s1'))
    expect(b.svc.list.getSnapshot().current).toBe('s1')
    expect(() => { b.svc.open(sid('ghost')) }).toThrow(/unknown session ghost/)
    expect(b.svc.list.getSnapshot().current).toBe('s1') // failed open leaves the selection alone
  })

  it('clear() blanks list.current and the persisted selection', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v) },
      removeItem: (k: string) => { storage.delete(k) },
      clear: () => { storage.clear() },
    })
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    b.svc.open(sid('s1'))
    expect(storage.get('dsh.sessions.current')).toContain('s1')
    b.svc.clear()
    expect(b.svc.list.getSnapshot().current).toBeUndefined()
    // Persisted wipe: a fresh service with the same storage stays on empty.
    const again = bench()
    await feedList(again, [{ id: 's1' }])
    expect(again.svc.list.getSnapshot().current).toBeUndefined()
  })

  it('masks (not destroys) the selection while its session is off the list', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }, { id: 's2' }])
    b.svc.open(sid('s1'))
    await feedList(b, [{ id: 's2' }]) // s1 removed → current falls to the empty state
    expect(b.svc.list.getSnapshot().current).toBeUndefined()
    await feedList(b, [{ id: 's1' }, { id: 's2' }]) // s1 returns → selection resurfaces
    expect(b.svc.list.getSnapshot().current).toBe('s1')
  })

  it('persists the selection under dsh.sessions.current and rehydrates it into a fresh service', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v) },
    })
    const first = bench()
    await feedList(first, [{ id: 's1' }])
    first.svc.open(sid('s1'))
    expect(storage.get('dsh.sessions.current')).toContain('s1')
    // A fresh boot (same storage) recovers the selection once the list holds the session.
    const second = bench()
    await feedList(second, [{ id: 's1' }])
    expect(second.svc.list.getSnapshot().current).toBe('s1')
  })
})

describe('cell (render-layer session kit)', () => {
  it('resolves an identity-stable {sessionId, session} cell through the current projection', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    b.svc.open(sid('s1'))
    const info = b.svc.currentProvideInfo.getSnapshot()
    expect(info.sessionId).toBe('s1')
    // The bundle carries bare observables; hook binding happens in React.
    expect(info.hooks['session']).toBe(b.svc.binding(sid('s1'))?.session)
    // Re-staging the same id republishes nothing: identity holds.
    b.svc.open(sid('s1'))
    expect(b.svc.currentProvideInfo.getSnapshot()).toBe(info)
  })

  it('currentProvideInfo follows selection: absent projection ↔ definite bundle, notified on each move', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }, { id: 's2' }])
    const absent = b.svc.currentProvideInfo.getSnapshot()
    expect(absent.sessionId).toBeUndefined()
    expect(Object.hasOwn(absent.hooks, 'session')).toBe(true)
    const notified = vi.fn()
    b.svc.currentProvideInfo.subscribe(notified)
    b.svc.open(sid('s1'))
    const s1Bundle = b.svc.currentProvideInfo.getSnapshot()
    expect(s1Bundle.sessionId).toBe('s1')
    expect(s1Bundle.hooks['session']).toBe(b.svc.binding(sid('s1'))?.session)
    expect(notified).toHaveBeenCalledTimes(1)
    b.svc.open(sid('s2'))
    const s2Bundle = b.svc.currentProvideInfo.getSnapshot()
    expect(s2Bundle.sessionId).toBe('s2')
    expect(s2Bundle).not.toBe(s1Bundle)
    expect(notified).toHaveBeenCalledTimes(2)
    b.svc.clear()
    await Promise.resolve() // clearSelection projects through the manager notifier
    expect(b.svc.currentProvideInfo.getSnapshot().sessionId).toBeUndefined()
  })

  it('a provider roster change under a stable current id republishes the bundle', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    b.svc.open(sid('s1'))
    const before = b.svc.currentProvideInfo.getSnapshot()
    const notified = vi.fn()
    b.svc.currentProvideInfo.subscribe(notified)
    const source = { getSnapshot: () => 'live', subscribe: () => () => {} }
    const dispose = b.svc.provide({
      hooks: ['extra'],
      props: ['marker'],
      resolve: () => ({ hooks: { extra: source }, props: { marker: 7 } }),
    })
    const added = b.svc.currentProvideInfo.getSnapshot()
    expect(added).not.toBe(before)
    expect(added).toMatchObject({ sessionId: 's1', props: { marker: 7 } })
    expect(added.hooks['extra']).toBe(source)
    expect(notified).toHaveBeenCalledTimes(1)
    dispose()
    const removed = b.svc.currentProvideInfo.getSnapshot()
    expect(removed).not.toBe(added)
    expect(Object.hasOwn(removed.hooks, 'extra')).toBe(false)
    expect(notified).toHaveBeenCalledTimes(2)
  })

  it('an unsubscribed currentProvideInfo listener stops receiving notifications', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    const notified = vi.fn()
    const off = b.svc.currentProvideInfo.subscribe(notified)
    off()
    b.svc.open(sid('s1'))
    expect(notified).not.toHaveBeenCalled()
  })

  it('binding() is pure resolution: no staging, no deferred sweep', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }, { id: 's2' }])
    b.svc.open(sid('s1')) // staged
    b.svc.binding(sid('s2')) // resolution only — must NOT move the stage
    await feedList(b, [{ id: 's2' }]) // s1 removed: still staged → deferred, scope survives
    expect(b.svc.scope(sid('s1'))).toBeDefined()
  })

  it('staging (current write) opens the session event window; resolution and re-staging do not re-pull', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }, { id: 's2' }])
    const historyCalls = () => b.api.calls.filter(c => c.method === 'session.history')
    // Resolution is addressing, not staging: no window pull.
    b.svc.scope(sid('s1'))
    b.svc.binding(sid('s1'))
    expect(historyCalls()).toHaveLength(0)
    b.svc.open(sid('s1'))
    expect(historyCalls().map(c => (c.payload as { sessionId: string }).sessionId)).toEqual(['s1'])
    // Same current again: no second pull.
    b.svc.open(sid('s1'))
    expect(historyCalls()).toHaveLength(1)
    // Stage moves: the new occupant opens.
    b.svc.open(sid('s2'))
    expect(historyCalls().map(c => (c.payload as { sessionId: string }).sessionId)).toEqual(['s1', 's2'])
  })

  it('startup restore: a persisted selection validated by the first projection opens its window unprompted', async () => {
    const storage = new Map<string, string>([
      ['dsh.sessions.current', JSON.stringify({ sessionId: 's1' })],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v) },
    })
    try {
      const b = bench()
      expect(b.api.calls.filter(c => c.method === 'session.history')).toHaveLength(0)
      await feedList(b, [{ id: 's1' }]) // projection validates the persisted id → current lands → stage follows
      const historyCalls = b.api.calls.filter(c => c.method === 'session.history')
      expect(historyCalls.map(c => (c.payload as { sessionId: string }).sessionId)).toEqual(['s1'])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('slot-store scope prune hook', () => {
  it('notifies ctx.slots.pruneStoreScope when a scope dies (both teardown paths)', async () => {
    const b = bench()
    const pruneStoreScope = vi.fn()
    b.ctx.reflect.provide('slots', { pruneStoreScope })
    await feedList(b, [{ id: 's1' }, { id: 's2' }])
    b.svc.scope(sid('s1'))
    b.svc.scope(sid('s2'))
    b.svc.open(sid('s2')) // s2 staged
    await feedList(b, []) // s1 off stage → immediate drop; s2 staged → deferred
    expect(pruneStoreScope).toHaveBeenCalledWith('s1')
    expect(pruneStoreScope).not.toHaveBeenCalledWith('s2')
    await feedList(b, [{ id: 's3' }])
    b.svc.open(sid('s3')) // stage moves → deferred sweep drops s2
    expect(pruneStoreScope).toHaveBeenCalledWith('s2')
  })

  it('tolerates a slots-less boot (object-layer benches carry no slot service)', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    b.svc.scope(sid('s1'))
    await feedList(b, []) // teardown without ctx.slots must not throw
    expect(b.svc.scope(sid('s1'))).toBeUndefined()
  })
})

describe('catalog-addressed navigation', () => {
  it('uses catalog labels for a listed addressed route', async () => {
    const b = bench()
    b.api.onSubagentList = (payload) => {
      const { parentSessionId } = payload as { parentSessionId: SessionId }
      if (parentSessionId === sid('root')) {
        return Promise.resolve(ok({
          entries: [{
            kind: 'child', id: sid('child'), mode: 'continuable', label: 'Child',
            activity: 'inactive', hasChildren: true,
          }] as never[],
          parentAvailable: true,
        }))
      }
      if (parentSessionId === sid('child')) {
        return Promise.resolve(ok({
          entries: [{
            kind: 'child', id: sid('grandchild'), mode: 'continuable', label: 'Grandchild',
            activity: 'inactive', hasChildren: false,
          }] as never[],
          parentAvailable: false,
        }))
      }
      return Promise.resolve(ok({ entries: [], parentAvailable: false }))
    }
    await feedList(b, [
      { id: 'root' },
      { id: 'child', cwd: '/summary-child', parentId: 'root', origin: 'subagent' },
      { id: 'grandchild', cwd: '/summary-grandchild', parentId: 'child', origin: 'subagent' },
    ])
    await b.svc.refreshSubagents(sid('root'))
    await b.svc.refreshSubagents(sid('child'))
    b.svc.openSubagent({
      parentSessionId: sid('child'), childSessionId: sid('grandchild'), mode: 'continuable',
    })

    expect(b.svc.list.getSnapshot().byId[sid('child')]?.displayTitle).toBe('Child')
    expect(b.svc.list.getSnapshot().byId[sid('grandchild')]?.displayTitle).toBe('Grandchild')
  })

  it('projects a directly opened descendant route without retaining ancestor scopes or addresses', async () => {
    const b = bench()
    b.api.onSubagentList = (payload) => {
      const { parentSessionId } = payload as { parentSessionId: SessionId }
      if (parentSessionId === sid('root')) {
        return Promise.resolve(ok({
          entries: [{
            kind: 'child', id: sid('child'), mode: 'continuable', label: 'Child',
            activity: 'inactive', hasChildren: true,
          }] as never[],
          parentAvailable: true,
        }))
      }
      if (parentSessionId === sid('child')) {
        return Promise.resolve(ok({
          entries: [{
            kind: 'child', id: sid('grandchild'), mode: 'continuable', label: 'Grandchild',
            activity: 'inactive', hasChildren: false,
          }] as never[],
          parentAvailable: false,
        }))
      }
      return Promise.resolve(ok({ entries: [], parentAvailable: false }))
    }
    await feedList(b, [{ id: 'root' }])
    await b.svc.refreshSubagents(sid('root'))
    await b.svc.refreshSubagents(sid('child'))
    b.svc.openSubagent({
      parentSessionId: sid('child'), childSessionId: sid('grandchild'), mode: 'continuable',
    })

    const list = b.svc.list.getSnapshot()
    expect(list.ids).toEqual([sid('root')])
    expect(list.byId[sid('child')]).toMatchObject({ parentId: sid('root'), origin: 'subagent' })
    expect(list.byId[sid('grandchild')]).toMatchObject({ parentId: sid('child'), origin: 'subagent' })
    expect(b.svc.binding(sid('child'))).toBeUndefined()
    expect(b.svc.subagentAddress(sid('child'))).toBeUndefined()

    b.svc.open(sid('child'))
    expect(b.svc.list.getSnapshot().current).toBe(sid('child'))
    expect(b.svc.subagentAddress(sid('child'))).toEqual({
      parentSessionId: sid('root'), childSessionId: sid('child'), mode: 'continuable',
    })
  })
})

describe('create', () => {
  it('passes a preallocated id and preserves it on ordinary failure', async () => {
    const b = bench()
    b.api.onCreate = () => Promise.resolve(ok({ sessionId: sid('fresh') }))
    await expect(b.svc.create({ cwd: '/w', sessionId: sid('fresh') })).resolves.toBe('fresh')
    expect(b.api.callsOf('session.create')).toEqual([{ cwd: '/w', sessionId: 'fresh' }])
    b.api.onCreate = () => Promise.resolve({
      rpcId: 'e' as never,
      result: { ok: false as const, error: { code: 'internal' as const, message: '爆了', details: {} } },
    } as never)
    const failure = await b.svc.create({ sessionId: sid('candidate') }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(SessionCreateError)
    expect(failure).toMatchObject({
      requestedSessionId: 'candidate',
      rpcError: { code: 'internal', message: '爆了' },
    })
  })

  it('resolves with the session already listed and binding-resolvable (no flush wait)', async () => {
    const b = bench()
    b.api.onCreate = () => Promise.resolve(ok({ sessionId: sid('born') }))
    const born = await b.svc.create({ workspaceId: 'ws' as never })
    // Synchronously after resolution — the draft hand-off contract: the
    // create echo IS the entity entering the client's view (blank row +
    // resolvable scope/binding), no notifier flush in between.
    expect(b.svc.list.getSnapshot().byId[born]).toMatchObject({ id: 'born', blank: true })
    expect(b.svc.binding(born)).toBeDefined()
    expect(b.svc.scope(born)).toBeDefined()
  })

  it('lists the published id after Workspace attachment fails (publication precedes attachment)', async () => {
    const b = bench()
    b.api.onCreate = () => Promise.resolve({
      rpcId: 'attach' as never,
      result: {
        ok: false,
        error: {
          code: 'workspace-attach-failed', message: 'ledger unavailable',
          details: { sessionId: sid('published'), workspaceId: 'ws' },
        },
      },
    } as never)
    const failure = await b.svc.create({
      workspaceId: 'ws' as never,
      sessionId: sid('published'),
    }).catch((error: unknown) => error)
    await Promise.resolve()
    expect(failure).toBeInstanceOf(SessionCreateError)
    expect(failure).toMatchObject({
      requestedSessionId: 'published',
      rpcError: { code: 'workspace-attach-failed' },
    })
    expect(b.svc.list.getSnapshot().byId[sid('published')]).toMatchObject({ id: 'published', blank: true })
  })
})

describe('fork', () => {
  it.each([
    ['Roadmap', 'Roadmap (1)'],
    ['Roadmap (1)', 'Roadmap (2)'],
    ['计划（1）', '计划（2）'],
    ['计划 （9）', '计划 （10）'],
  ])('increments the durable title %j after the child is published', async (sourceTitle, childTitle) => {
    const b = bench()
    b.svc.handleMuxEnvelope({
      rpcId: 'source-title' as never,
      payload: { type: 'session/projection', sessionId: sid('source'), key: 'title', value: sourceTitle, seq: 2 } as never,
    })
    await feedList(b, [{ id: 'source', cwd: '/work' }])
    b.api.onFork = () => Promise.resolve(ok({ sessionId: sid('child') }))
    b.api.onRename = (payload) => {
      const { title } = payload as { title: string }
      return Promise.resolve(ok({ title, seq: 3 }))
    }

    await expect(b.svc.fork({
      sessionId: sid('source'), atSeq: 7, increaseTitle: true,
    })).resolves.toBe('child')

    expect(b.api.callsOf('session.fork')).toEqual([{ sessionId: 'source', atSeq: 7 }])
    expect(b.api.callsOf('session.rename')).toEqual([{ sessionId: 'child', title: childTitle }])
    await Promise.resolve()
    expect(b.svc.list.getSnapshot().byId[sid('child')]).toMatchObject({
      title: childTitle,
      displayTitle: childTitle,
      parentId: 'source',
    })
  })

  it('floors a fractional anchor to the real event seq the wire accepts', async () => {
    const b = bench()
    await feedList(b, [{ id: 'source', cwd: '/work' }])
    b.api.onFork = () => Promise.resolve(ok({ sessionId: sid('child') }))

    // The frozen node of an interrupted turn carries turnEnd.seq - 0.9.
    await expect(b.svc.fork({ sessionId: sid('source'), atSeq: 41.1 })).resolves.toBe('child')

    expect(b.api.callsOf('session.fork')).toEqual([{ sessionId: 'source', atSeq: 41 }])
  })

  it('does not rename without the title policy or a durable source title', async () => {
    const b = bench()
    await feedList(b, [{ id: 'source', cwd: '/work' }])
    b.api.onFork = () => Promise.resolve(ok({ sessionId: sid('child') }))
    await expect(b.svc.fork({ sessionId: sid('source'), increaseTitle: true })).resolves.toBe('child')
    expect(b.api.callsOf('session.rename')).toEqual([])

    b.api.onFork = () => Promise.resolve(ok({ sessionId: sid('child-2') }))
    await expect(b.svc.fork({ sessionId: sid('source') })).resolves.toBe('child-2')
    expect(b.api.callsOf('session.rename')).toEqual([])
  })

  it('rejects when child rename fails while keeping the published child addressable', async () => {
    const b = bench()
    b.svc.handleMuxEnvelope({
      rpcId: 'source-title' as never,
      payload: { type: 'session/projection', sessionId: sid('source'), key: 'title', value: 'Roadmap', seq: 2 } as never,
    })
    await feedList(b, [{ id: 'source' }])
    b.api.onFork = () => Promise.resolve(ok({ sessionId: sid('child') }))
    b.api.onRename = () => Promise.resolve(err({
      code: 'title-invalid', message: 'rejected', details: { sessionId: sid('child') },
    }))

    await expect(b.svc.fork({ sessionId: sid('source'), increaseTitle: true }))
      .rejects.toThrow('fork child rename failed: title-invalid: rejected')
    expect(b.svc.binding(sid('child'))).toBeDefined()
  })
})

describe('scope lifecycle rides the list mirror (entity parity: no client-side pre-birth)', () => {
  it('a session-added frame births the row (blank) and makes the scope resolvable; removal prunes it', async () => {
    const b = bench()
    await feedList(b, [])
    expect(b.svc.scope(sid('s-new'))).toBeUndefined() // not in view: no scope, no exceptions
    b.svc.handleHostEnvelope({
      rpcId: 'add' as never,
      payload: { type: 'host/session-added', sessionId: sid('s-new'), blank: true, cwd: '/w/a' } as never,
    })
    await Promise.resolve()
    const scoped = b.svc.scope(sid('s-new'))
    expect(scoped).toBeDefined()
    expect(scopeOf(scoped as Context)).toBe('s-new')
    b.svc.handleHostEnvelope({
      rpcId: 'rm' as never,
      payload: { type: 'host/session-removed', sessionId: sid('s-new') },
    })
    await Promise.resolve()
    expect(b.svc.scope(sid('s-new'))).toBeUndefined()
  })
})

describe('blank mirror', () => {
  it('flips blank=false from the running:true status frame (cross-client conversion)', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1', blank: true }])
    expect(b.svc.list.getSnapshot().byId[sid('s1')]).toMatchObject({ blank: true })
    b.svc.handleHostEnvelope({
      rpcId: 'st' as never,
      payload: { type: 'host/session-status', sessionId: sid('s1'), running: true },
    })
    await Promise.resolve()
    expect(b.svc.list.getSnapshot().byId[sid('s1')]).toMatchObject({ blank: false, running: true })
    // The instantiated Session mirrors the same flip.
    expect(b.svc.binding(sid('s1'))?.session.getSnapshot().blank).toBe(false)
  })

  it('flips blank=false on prompt ACCEPTANCE, not on the attempt', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1', blank: true, cwd: '/w/a' }])
    const session = b.svc.binding(sid('s1'))!.session
    expect(session.getSnapshot().blank).toBe(true)
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onPrompt']>>>()
    b.api.onPrompt = () => gate.promise
    const send = session.prompt([{ type: 'text', text: 'hi' }], 'queue')
    // In flight: still blank (the flip point is the success response, which
    // proves the user message reached the host log).
    expect(session.getSnapshot().blank).toBe(true)
    gate.resolve(ok({ accepted: true as const }))
    await send
    expect(session.getSnapshot().blank).toBe(false)
    await Promise.resolve()
    expect(b.svc.list.getSnapshot().byId[sid('s1')]).toMatchObject({ blank: false })
  })

  it('keeps a rejected first prompt blank: hidden and still reusable', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1', blank: true, cwd: '/w/a' }])
    const session = b.svc.binding(sid('s1'))!.session
    b.api.onPrompt = () => Promise.resolve({
      rpcId: 'busy' as never,
      result: { ok: false as const, error: { code: 'internal' as const, message: 'agent busy', details: {} } },
    } as never)
    const result = await session.prompt([{ type: 'text', text: 'hi' }], 'queue')
    expect(result.ok).toBe(false)
    // No flip on failure: local stays aligned with the host authority
    // (events.length still 0), so the session stays hidden and reusable.
    expect(session.getSnapshot().blank).toBe(true)
    await Promise.resolve()
    expect(b.svc.list.getSnapshot().byId[sid('s1')]).toMatchObject({ blank: true })
  })

  it('takes session-added blank=true as the hidden birth and list blank as reconnect authority', async () => {
    const b = bench()
    await feedList(b, [])
    b.svc.handleHostEnvelope({
      rpcId: 'add' as never,
      payload: { type: 'host/session-added', sessionId: sid('s-new'), blank: true, cwd: '/w/a' } as never,
    })
    await Promise.resolve()
    expect(b.svc.list.getSnapshot().byId[sid('s-new')]).toMatchObject({ blank: true })
    // Reconnect re-pull: the summary's blank=false wins (authoritative alignment).
    await feedList(b, [{ id: 's-new', blank: false, cwd: '/w/a' }])
    expect(b.svc.list.getSnapshot().byId[sid('s-new')]).toMatchObject({ blank: false })
  })

  it('never re-blanks: a stale blank=true summary cannot hide an engaged session', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1', blank: true }])
    const session = b.svc.binding(sid('s1'))!.session
    await session.prompt([{ type: 'text', text: 'hi' }], 'queue')
    await Promise.resolve()
    expect(b.svc.list.getSnapshot().byId[sid('s1')]).toMatchObject({ blank: false })
    // The next list pull still claims blank (host hasn't logged the message yet).
    await feedList(b, [{ id: 's1', blank: true }])
    expect(b.svc.binding(sid('s1'))?.session.getSnapshot().blank).toBe(false)
  })
})

describe('coverage tails (branch duals)', () => {
  it('displayTitleOf falls back to the id for empty and separator-only cwd', async () => {
    const b = bench()
    await feedList(b, [{ id: 'no-base', cwd: '///' }, { id: 'empty-cwd', cwd: '' }])
    const { byId } = b.svc.list.getSnapshot()
    expect(byId[sid('no-base')]?.displayTitle).toBe('no-base')
    expect(byId[sid('empty-cwd')]?.displayTitle).toBe('empty-cwd')
    expect(byId[sid('no-base')]?.title).toBeUndefined()
  })

  it('binding for an unknown session returns undefined and leaves the staged scope intact', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    b.svc.open(sid('s1'))
    expect(b.svc.binding(sid('ghost'))).toBeUndefined()
    // Stage unchanged: removing s1 defers (still staged), proving the ghost lookup touched nothing.
    await feedList(b, [])
    expect(b.svc.scope(sid('s1'))).toBeDefined()
  })

  it('a masked current gap holds the stage (no teardown, no re-open) until the stage moves', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    b.svc.open(sid('s1'))
    const historyCalls = () => b.api.calls.filter(c => c.method === 'session.history')
    expect(historyCalls()).toHaveLength(1)
    await feedList(b, []) // removed while staged: current masks to undefined, stage holds → deferred
    expect(b.svc.scope(sid('s1'))).toBeDefined()
    // Resurfacing re-projects current = s1: same stage occupant, no second pull.
    await feedList(b, [{ id: 's1' }])
    expect(historyCalls()).toHaveLength(1)
    expect(b.svc.list.getSnapshot().current).toBe('s1')
  })

  it('sweep hits both deferral edges: staged-id skip and an already-vacated scope record', async () => {
    const b = bench()
    await feedList(b, [{ id: 'a' }, { id: 'b' }])
    b.svc.scope(sid('a'))
    b.svc.open(sid('b')) // stage: b; both scoped
    await feedList(b, []) // a removed off stage → torn immediately; b removed staged → deferred
    // Move the stage to a THIRD id while b stays deferred: sweep walks a set
    // containing b (torn).
    await feedList(b, [{ id: 'c' }])
    b.svc.open(sid('c'))
    expect(b.svc.scope(sid('b'))).toBeUndefined()
    // Deferral for an id whose record was never minted: force the deferral
    // via removed list state — sweep must tolerate the missing record.
    await feedList(b, []) // c removed while staged → deferred (scope exists)
    await feedList(b, [{ id: 'd' }])
    b.svc.open(sid('d')) // sweep tears c
    expect(b.svc.scope(sid('c'))).toBeUndefined()
  })

})
