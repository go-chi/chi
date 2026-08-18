import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { SessionRuntime } from '../src/client/sessions/service.ts'
import { WorkspaceManager } from '../src/client/workspaces/manager.ts'
import { DirectoryBrowseError, WorkspaceCreateError, WorkspaceRuntime } from '../src/client/workspaces/service.ts'
import { FakeApiClient, deferred, err, fakeRemote, ok } from './fake-api.client.ts'

const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

function workspace(id: string, sessionIds: SessionId[] = [], createdAt = '2026-01-01T00:00:00.000Z'): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/w/${id}`, title: id, sessionIds,
    createdAt, updatedAt: createdAt,
  }
}

describe('WorkspaceManager', () => {
  it('replays changed frames over hydration and adopts the durable order on refresh', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onWorkspaceList']>>>()
    api.onWorkspaceList = () => gate.promise
    const manager = new WorkspaceManager(api)
    const hydration = manager.refresh()
    manager.handleHostEnvelope({
      rpcId: 'changed' as never,
      payload: { type: 'host/workspace-changed', workspace: workspace('new') },
    })
    gate.resolve(ok({ items: [workspace('old')] as never[] }))
    await hydration
    expect(manager.getSnapshot()).toMatchObject({ phase: 'ready', state: 'idle' })
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['new', 'old'])

    api.onWorkspaceList = () => Promise.resolve(ok({
      items: [workspace('old'), workspace('new')] as never[],
    }))
    await manager.refresh()
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['old', 'new'])
  })

  it('single-flights refreshes and exposes result and transport failures independently of readiness', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onWorkspaceList']>>>()
    api.onWorkspaceList = () => gate.promise
    const manager = new WorkspaceManager(api)
    const first = manager.refresh()
    const second = manager.refresh()
    expect(manager.getSnapshot().state).toBe('loading')
    gate.resolve(ok({ items: [] }))
    await Promise.all([first, second])
    expect(api.callsOf('workspace.list')).toHaveLength(1)

    api.onWorkspaceList = () => Promise.resolve(err({ code: 'internal', message: 'down', details: {} }))
    await manager.refresh()
    expect(manager.getSnapshot()).toMatchObject({ phase: 'ready', state: 'error', error: { message: 'down' } })
    api.onWorkspaceList = () => Promise.reject(new Error('wire down'))
    await manager.refresh()
    expect(manager.getSnapshot()).toMatchObject({ phase: 'ready', state: 'error', error: { message: 'wire down' } })
  })

  it('creates by path, prepends a new row, and folds failures', async () => {
    const api = new FakeApiClient()
    const manager = new WorkspaceManager(api)
    api.onWorkspaceCreate = payload => Promise.resolve(ok({
      workspace: workspace('created', [], '2026-02-01T00:00:00.000Z'),
      created: true,
      payload,
    } as never))
    await expect(manager.create({ path: '/w/created' })).resolves.toMatchObject({ ok: true })
    expect(api.callsOf('workspace.create')).toEqual([{ path: '/w/created' }])
    expect(manager.getSnapshot().items[0]?.workspaceId).toBe('created')

    api.onWorkspaceCreate = () => Promise.reject(new Error('create transport'))
    await expect(manager.create({ path: '/w/existing' })).resolves.toMatchObject({
      ok: false, error: { code: 'internal', message: 'create transport' },
    })
  })

  it('reorders optimistically while newer Host frames outrank unary echoes and failures roll back', async () => {
    const api = new FakeApiClient()
    api.onWorkspaceList = () => Promise.resolve(ok({
      items: [workspace('one'), workspace('two'), workspace('three')] as never[],
    }))
    const manager = new WorkspaceManager(api)
    await manager.refresh()

    const gate = deferred<Awaited<ReturnType<FakeApiClient['onWorkspaceInsertBefore']>>>()
    api.onWorkspaceInsertBefore = () => gate.promise
    const pending = manager.insertBefore(wid('three'), wid('one'))
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['three', 'one', 'two'])
    manager.handleHostEnvelope({
      rpcId: 'newer-order' as never,
      payload: {
        type: 'host/workspace-order-changed',
        workspaceIds: [wid('one'), wid('three'), wid('two')],
      },
    })
    gate.resolve(ok({ workspaceIds: [wid('three'), wid('one'), wid('two')] }))
    await pending
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['one', 'three', 'two'])

    api.onWorkspaceInsertBefore = () => Promise.resolve(err({
      code: 'workspace-not-found', message: 'gone', details: { workspaceId: 'three' },
    }))
    const rejected = manager.insertBefore(wid('three'))
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['one', 'two', 'three'])
    await expect(rejected).resolves.toMatchObject({ ok: false })
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['one', 'three', 'two'])

    api.onWorkspaceInsertBefore = () => Promise.reject(new Error('transport down'))
    const disconnected = manager.insertBefore(wid('three'), wid('one'))
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['three', 'one', 'two'])
    await expect(disconnected).rejects.toThrow('transport down')
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['one', 'three', 'two'])
  })

  it('rolls overlapping rejected reorders back to the last Host-confirmed order', async () => {
    const api = new FakeApiClient()
    api.onWorkspaceList = () => Promise.resolve(ok({
      items: [workspace('one'), workspace('two'), workspace('three')] as never[],
    }))
    const manager = new WorkspaceManager(api)
    await manager.refresh()
    const firstGate = deferred<Awaited<ReturnType<FakeApiClient['onWorkspaceInsertBefore']>>>()
    const secondGate = deferred<Awaited<ReturnType<FakeApiClient['onWorkspaceInsertBefore']>>>()
    let request = 0
    api.onWorkspaceInsertBefore = () => request++ === 0 ? firstGate.promise : secondGate.promise

    const first = manager.insertBefore(wid('three'), wid('one'))
    const second = manager.insertBefore(wid('two'), wid('three'))
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['two', 'three', 'one'])

    firstGate.resolve(err({
      code: 'workspace-not-found', message: 'first rejected', details: { workspaceId: 'three' },
    }))
    await expect(first).resolves.toMatchObject({ ok: false })
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['two', 'three', 'one'])

    secondGate.resolve(err({
      code: 'workspace-not-found', message: 'second rejected', details: { workspaceId: 'two' },
    }))
    await expect(second).resolves.toMatchObject({ ok: false })
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['one', 'two', 'three'])
  })

  it('replays removal over an in-flight baseline and ignores duplicate or late updates', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onWorkspaceList']>>>()
    api.onWorkspaceList = () => gate.promise
    const manager = new WorkspaceManager(api)
    const hydration = manager.refresh()
    manager.handleHostEnvelope({
      rpcId: 'removed' as never,
      payload: { type: 'host/workspace-removed', workspaceId: wid('gone') },
    })
    gate.resolve(ok({ items: [workspace('gone'), workspace('kept')] as never[] }))
    await hydration
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['kept'])

    manager.handleHostEnvelope({
      rpcId: 'late-change' as never,
      payload: { type: 'host/workspace-changed', workspace: workspace('gone') },
    })
    manager.handleHostEnvelope({
      rpcId: 'duplicate-remove' as never,
      payload: { type: 'host/workspace-removed', workspaceId: wid('gone') },
    })
    expect(manager.getSnapshot().items.map(item => item.workspaceId)).toEqual(['kept'])
  })

  it('removes from the unary delete echo while a refresh is in flight', async () => {
    const api = new FakeApiClient()
    api.onWorkspaceList = () => Promise.resolve(ok({ items: [workspace('gone')] as never[] }))
    const manager = new WorkspaceManager(api)
    await manager.refresh()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onWorkspaceList']>>>()
    api.onWorkspaceList = () => gate.promise
    const refresh = manager.refresh()

    await expect(manager.delete(wid('gone'))).resolves.toMatchObject({ ok: true })
    expect(api.callsOf('workspace.delete')).toEqual([{ workspaceId: 'gone' }])
    expect(manager.getSnapshot().items).toEqual([])
    gate.resolve(ok({ items: [workspace('gone')] as never[] }))
    await refresh
    expect(manager.getSnapshot().items).toEqual([])
  })
})

describe('WorkspaceRuntime', () => {
  it('feeds readiness and recent-Workspace targeting without changing Host order', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)
    api.onWorkspaceList = () => Promise.resolve(ok({
      items: [
        workspace('stable-first', [], '2026-01-03T00:00:00.000Z'),
        workspace('active', [sid('s-active')], '2026-01-01T00:00:00.000Z'),
      ] as never[],
    }))
    await workspaces.refresh()
    await Promise.resolve()
    expect(workspaces.list.getSnapshot()).toMatchObject({ baselinesReady: false, recentWorkspaceId: undefined })

    api.onList = () => Promise.resolve(ok({
      items: [{ sessionId: sid('s-active'), updatedAt: Date.parse('2026-02-01'), running: false, blank: false }] as never[],
    }))
    await sessions.refresh()
    await Promise.resolve()
    await Promise.resolve()
    expect(workspaces.list.getSnapshot()).toMatchObject({
      baselinesReady: true,
      recentWorkspaceId: 'active',
    })
    expect(workspaces.list.getSnapshot().items.map(item => item.workspaceId)).toEqual(['stable-first', 'active'])
  })

  it('connectWorkspace reuses the workspace-member blank session and creates otherwise', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)
    api.onWorkspaceList = () => Promise.resolve(ok({
      items: [workspace('alpha', [sid('s-blank')]), workspace('beta'), workspace('gamma')] as never[],
    }))
    api.onList = () => Promise.resolve(ok({
      items: [
        // Stray blank at alpha's path but NOT accounted under alpha (a CLI
        // session birthed at the host cwd), sorted before the member blank:
        // the scan must skip it and keep looking for a member hit.
        { sessionId: sid('s-stray-alpha'), updatedAt: 1, running: false, blank: true, cwd: '/w/alpha' },
        // Blank session parked in alpha (cwd == workspace path canon AND
        // accounted under alpha): the reuse hit.
        { sessionId: sid('s-blank'), updatedAt: 2, running: false, blank: true, cwd: '/w/alpha' },
        // Non-blank sibling in beta must never be reused.
        { sessionId: sid('s-active'), updatedAt: 3, running: false, blank: false, cwd: '/w/beta' },
        // Stray blank at gamma's path but NOT accounted under gamma (a CLI
        // session birthed at the host cwd): cwd alone must not hijack it —
        // reuse would open a session gamma cannot show, so New Session mints
        // a fresh accounted one instead.
        { sessionId: sid('s-stray'), updatedAt: 4, running: false, blank: true, cwd: '/w/gamma' },
      ] as never[],
    }))
    await Promise.all([workspaces.refresh(), sessions.refresh()])
    await Promise.resolve()

    // Hit: same workspace → the parked member blank comes back (the earlier
    // cwd-matching non-member stray is skipped), no create RPC.
    await expect(workspaces.connectWorkspace(wid('alpha'))).resolves.toBe('s-blank')
    expect(api.callsOf('session.create')).toEqual([])
    // Resolution guarantee: the id is binding-resolvable synchronously.
    expect(sessions.binding(sid('s-blank'))).toBeDefined()

    // Miss: beta has only a non-blank session → host create with workspaceId.
    api.onCreate = () => Promise.resolve(ok({ sessionId: sid('s-fresh') }))
    await expect(workspaces.connectWorkspace(wid('beta'))).resolves.toBe('s-fresh')
    expect(api.callsOf('session.create')).toEqual([{ workspaceId: 'beta' }])
    // Same guarantee on the create arm (draft hand-off writes the machine pre-open).
    expect(sessions.binding(sid('s-fresh'))).toBeDefined()

    // Miss: the stray blank matches gamma's path but is not a gamma member →
    // never reused, a fresh accounted session is created instead.
    api.onCreate = () => Promise.resolve(ok({ sessionId: sid('s-fresh-3') }))
    await expect(workspaces.connectWorkspace(wid('gamma'))).resolves.toBe('s-fresh-3')
    expect(api.callsOf('session.create')).toEqual([{ workspaceId: 'beta' }, { workspaceId: 'gamma' }])

    // Unknown workspace fails loud instead of silently creating in nowhere.
    await expect(workspaces.connectWorkspace(wid('ghost'))).rejects.toThrow(/unknown workspace ghost/)

    // An archived blank is never reused: no surface can show it, so New
    // Session mints a fresh one for alpha instead.
    await workspaces.archiveSession(sid('s-blank'))
    api.onCreate = () => Promise.resolve(ok({ sessionId: sid('s-fresh-2') }))
    await expect(workspaces.connectWorkspace(wid('alpha'))).resolves.toBe('s-fresh-2')
  })

  it('a rejected first prompt keeps the blank session eligible for connectWorkspace reuse', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)
    api.onWorkspaceList = () => Promise.resolve(ok({ items: [workspace('alpha', [sid('s-blank')])] as never[] }))
    api.onList = () => Promise.resolve(ok({
      items: [{ sessionId: sid('s-blank'), updatedAt: 2, running: false, blank: true, cwd: '/w/alpha' }] as never[],
    }))
    await Promise.all([workspaces.refresh(), sessions.refresh()])
    await Promise.resolve()
    const session = sessions.binding(sid('s-blank'))!.session
    api.onPrompt = () => Promise.resolve(err({ code: 'internal', message: 'agent busy', details: {} }) as never)
    await session.prompt([{ type: 'text', text: 'hi' }], 'queue')
    await Promise.resolve()
    // Failure leaves blank intact, so the same session is still the reuse hit.
    await expect(workspaces.connectWorkspace(wid('alpha'))).resolves.toBe('s-blank')
    expect(api.callsOf('session.create')).toEqual([])
  })

  it('returns created Workspaces and preserves Host business errors', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)
    api.onWorkspaceCreate = () => Promise.resolve(ok({
      workspace: { ...workspace('picked'), path: '/w/alpha', title: 'alpha' }, created: true,
    }))
    await expect(workspaces.create({ path: '/w/alpha' })).resolves.toMatchObject({ workspaceId: 'picked' })
    expect(workspaces.list.getSnapshot().items[0]).toMatchObject({ path: '/w/alpha', title: 'alpha' })
    expect(api.callsOf('workspace.create')).toEqual([{ path: '/w/alpha' }])
    api.onWorkspaceCreate = () => Promise.resolve(err({
      code: 'workspace-invalid-path', message: 'missing', details: { path: '/missing' },
    }))
    const rejected = workspaces.create({ path: '/missing' })
    await expect(rejected).rejects.toThrow(/workspace-invalid-path: missing/)
    await expect(rejected).rejects.toBeInstanceOf(WorkspaceCreateError)
  })

  it('passes native directory selection and cancellation through without local state', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)
    api.onPickDirectory = () => Promise.resolve(ok({ path: '/w/alpha' }))
    await expect(workspaces.pickDirectory()).resolves.toBe('/w/alpha')
    api.onPickDirectory = () => Promise.resolve(ok({ path: null }))
    await expect(workspaces.pickDirectory()).resolves.toBeNull()
    expect(api.callsOf('host.pickDirectory')).toEqual([{}, {}])
    api.onPickDirectory = () => Promise.resolve(err({ code: 'internal', message: 'no chooser', details: {} }))
    await expect(workspaces.pickDirectory()).rejects.toThrow(/no chooser/)
  })

  it('passes listings and creation through the browse wire, wrapping business failures', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const workspaces = new WorkspaceRuntime(ctx, api, new SessionRuntime(ctx, api, fakeRemote()))
    const listing = { path: '/home/u', home: '/home/u', crumbs: [{ name: '/', path: '/', hidden: false }], entries: [{ name: 'p', path: '/home/u/p', hidden: false }], truncated: false }
    api.onListDirectory = () => Promise.resolve(ok(listing))
    await expect(workspaces.listDirectory()).resolves.toEqual(listing)
    await expect(workspaces.listDirectory('/home/u')).resolves.toEqual(listing)
    // The optional path is omitted from the payload, not sent as undefined.
    expect(api.callsOf('host.listDirectory')).toEqual([{}, { path: '/home/u' }])
    api.onListDirectory = () => Promise.resolve(err({ code: 'directory-unreadable', message: 'denied', details: { path: '/x' } }))
    const listFailure = workspaces.listDirectory('/x')
    await expect(listFailure).rejects.toBeInstanceOf(DirectoryBrowseError)
    await expect(listFailure).rejects.toMatchObject({ rpcError: { code: 'directory-unreadable' } })

    await expect(workspaces.createDirectory('/home/u', 'fresh')).resolves.toBe('/home/fake/new')
    expect(api.callsOf('host.createDirectory')).toEqual([{ path: '/home/u', name: 'fresh' }])
    api.onCreateDirectory = () => Promise.resolve(err({ code: 'directory-exists', message: 'taken', details: { path: '/home/u/fresh' } }))
    await expect(workspaces.createDirectory('/home/u', 'fresh')).rejects.toMatchObject({ rpcError: { code: 'directory-exists' } })
  })

  it('opens a filesystem path through the host without local state', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)
    await expect(workspaces.openPath('/w/alpha/a.ts')).resolves.toBeUndefined()
    expect(api.callsOf('host.openPath')).toEqual([{ path: '/w/alpha/a.ts' }])
    api.onOpenPath = () => Promise.resolve(err({ code: 'internal', message: 'boom', details: {} }))
    await expect(workspaces.openPath('/missing')).rejects.toThrow(/path open failed/)
  })

  it('deletes a Workspace or preserves it when the Host rejects deletion', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)
    api.onWorkspaceList = () => Promise.resolve(ok({ items: [workspace('alpha')] as never[] }))
    await workspaces.refresh()
    await expect(workspaces.delete(wid('alpha'))).resolves.toBeUndefined()
    expect(workspaces.list.getSnapshot().items).toEqual([])

    api.onWorkspaceDelete = () => Promise.resolve(err({
      code: 'workspace-not-found', message: 'gone', details: { workspaceId: 'ghost' },
    }))
    await expect(workspaces.delete(wid('ghost'))).rejects.toThrow(/workspace-not-found: gone/)
  })

  it('moves a Workspace through the durable order RPC and surfaces Host rejection', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const workspaces = new WorkspaceRuntime(ctx, api, new SessionRuntime(ctx, api, fakeRemote()))
    api.onWorkspaceList = () => Promise.resolve(ok({
      items: [workspace('one'), workspace('two')] as never[],
    }))
    await workspaces.refresh()
    api.onWorkspaceInsertBefore = () => Promise.resolve(ok({
      workspaceIds: [wid('two'), wid('one')],
    }))
    await expect(workspaces.insertBefore(wid('two'), wid('one'))).resolves.toBeUndefined()
    expect(api.callsOf('workspace.insertBefore')).toEqual([{
      workspaceId: 'two', beforeWorkspaceId: 'one',
    }])
    expect(workspaces.list.getSnapshot().items.map(item => item.workspaceId)).toEqual(['two', 'one'])

    api.onWorkspaceInsertBefore = () => Promise.resolve(err({
      code: 'workspace-not-found', message: 'gone', details: { workspaceId: 'ghost' },
    }))
    await expect(workspaces.insertBefore(wid('ghost'))).rejects.toThrow(/workspace-not-found: gone/)
  })

  it('targets New Session at explicit, current-session, then recent Workspaces and clears with none', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)
    api.onWorkspaceList = () => Promise.resolve(ok({
      items: [
        workspace('current-home', [sid('current')]),
        workspace('recent-home', [sid('recent')]),
      ] as never[],
    }))
    api.onList = () => Promise.resolve(ok({ items: [
      { sessionId: sid('current'), updatedAt: 1, running: false, blank: false },
      { sessionId: sid('recent'), updatedAt: 2, running: false, blank: false },
    ] as never[] }))
    await Promise.all([workspaces.refresh(), sessions.refresh()])
    await Promise.resolve()
    sessions.open(sid('current'))
    const unresolved = new Promise<SessionId>(() => {})
    const connect = vi.spyOn(workspaces, 'connectWorkspace').mockReturnValue(unresolved)

    workspaces.startSession(wid('recent-home'))
    await Promise.resolve()
    expect(connect).toHaveBeenLastCalledWith(wid('recent-home'))

    workspaces.startSession()
    await Promise.resolve()
    expect(connect).toHaveBeenLastCalledWith(wid('current-home'))

    sessions.clear()
    workspaces.startSession()
    await Promise.resolve()
    expect(connect).toHaveBeenLastCalledWith(wid('recent-home'))

    const emptyCtx = new Context()
    const emptyApi = new FakeApiClient()
    const emptySessions = new SessionRuntime(emptyCtx, emptyApi, fakeRemote())
    const emptyWorkspaces = new WorkspaceRuntime(emptyCtx, emptyApi, emptySessions)
    const clear = vi.spyOn(emptySessions, 'clear')
    emptyWorkspaces.startSession()
    expect(clear).toHaveBeenCalledOnce()
  })

  it('archives a session, projects the set from the response, list, and frame, and clears only the current one', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)
    api.onList = () => Promise.resolve(ok({
      items: [
        { sessionId: sid('s-open'), updatedAt: 2, running: false, blank: false },
        { sessionId: sid('s-idle'), updatedAt: 1, running: false, blank: false },
      ],
    }) as never)
    await sessions.refresh()
    sessions.open(sid('s-open'))

    // Archiving a non-current session installs the unary echo and keeps the selection.
    await expect(workspaces.archiveSession(sid('s-idle'))).resolves.toBeUndefined()
    expect(api.callsOf('workspace.archiveSession')).toEqual([{ sessionId: 's-idle' }])
    expect(workspaces.list.getSnapshot().archivedSessionIds).toEqual(['s-idle'])
    expect(sessions.list.getSnapshot().current).toBe('s-open')

    // Archiving the current session clears it into the New Session view state.
    api.onWorkspaceArchiveSession = () => Promise.resolve(ok({ archivedSessionIds: [sid('s-idle'), sid('s-open')] }))
    await workspaces.archiveSession(sid('s-open'))
    expect(workspaces.list.getSnapshot().archivedSessionIds).toEqual(['s-idle', 's-open'])
    expect(sessions.list.getSnapshot().current).toBeUndefined()

    // A Host failure leaves the set and the selection untouched.
    api.onWorkspaceArchiveSession = () => Promise.resolve(err({
      code: 'session-not-found', message: 'no session ghost', details: { sessionId: sid('ghost') },
    }))
    await expect(workspaces.archiveSession(sid('ghost'))).rejects.toThrow(/session-not-found/)
    expect(workspaces.list.getSnapshot().archivedSessionIds).toEqual(['s-idle', 's-open'])

    // The changed frame and the list baseline both re-install the full set.
    workspaces.handleHostEnvelope({
      rpcId: 'frame' as never,
      payload: { type: 'host/archived-sessions-changed', archivedSessionIds: [sid('s-idle')] },
    } as never)
    // Frame installs ride the notifier's microtask batch before projecting.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(workspaces.list.getSnapshot().archivedSessionIds).toEqual(['s-idle'])
    api.onWorkspaceList = () => Promise.resolve(ok({ items: [], archivedSessionIds: [sid('s-open')] }) as never)
    await workspaces.refresh()
    expect(workspaces.list.getSnapshot().archivedSessionIds).toEqual(['s-open'])
  })

  it('clears a current archived by a remote frame and shields the set from a stale in-flight baseline', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)
    api.onList = () => Promise.resolve(ok({
      items: [{ sessionId: sid('s-open'), updatedAt: 1, running: false, blank: false }],
    }) as never)
    await sessions.refresh()
    sessions.open(sid('s-open'))

    // A stale baseline is in flight (older, empty set) when another tab's
    // archive frame lands: the frame clears the current selection and its
    // set survives the baseline's later resolution.
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onWorkspaceList']>>>()
    api.onWorkspaceList = () => gate.promise
    const hydration = workspaces.refresh()
    workspaces.handleHostEnvelope({
      rpcId: 'frame' as never,
      payload: { type: 'host/archived-sessions-changed', archivedSessionIds: [sid('s-open')] },
    } as never)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(sessions.list.getSnapshot().current).toBeUndefined()
    gate.resolve(ok({ items: [], archivedSessionIds: [] }))
    await hydration
    expect(workspaces.list.getSnapshot().archivedSessionIds).toEqual(['s-open'])
    // The next (fresh) baseline is authoritative again.
    api.onWorkspaceList = () => Promise.resolve(ok({ items: [], archivedSessionIds: [] }) as never)
    await workspaces.refresh()
    expect(workspaces.list.getSnapshot().archivedSessionIds).toEqual([])
  })
})

describe('startInitialSelection', () => {
  function bench() {
    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)
    return { api, sessions, workspaces }
  }

  it('connects the recent Workspace blank session once baselines are ready and opens it', async () => {
    const b = bench()
    const stop = b.workspaces.startInitialSelection()
    // Nothing happens before both baselines land.
    expect(b.api.callsOf('session.create')).toHaveLength(0)

    b.api.onWorkspaceList = () => Promise.resolve(ok({
      items: [workspace('recent', [], '2026-01-02T00:00:00.000Z')] as never[],
    }))
    b.api.onCreate = () => Promise.resolve(ok({ sessionId: sid('s-new') }))
    await b.workspaces.refresh()
    await b.sessions.refresh()
    // Store notifications and the connect round trip are microtask-batched.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(b.api.callsOf('session.create')).toEqual([{ workspaceId: 'recent' }])
    expect(b.sessions.list.getSnapshot().current).toBe('s-new')
    stop()
  })

  it('stays idle when a session is already current or no recent Workspace exists', async () => {
    const withCurrent = bench()
    withCurrent.api.onList = () => Promise.resolve(ok({
      items: [{ sessionId: sid('s1'), updatedAt: 1, running: false, blank: false }] as never[],
    }))
    await withCurrent.sessions.refresh()
    withCurrent.sessions.open(sid('s1'))
    withCurrent.api.onWorkspaceList = () => Promise.resolve(ok({ items: [workspace('w1', [sid('s1')])] as never[] }))
    const stopCurrent = withCurrent.workspaces.startInitialSelection()
    await withCurrent.workspaces.refresh()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(withCurrent.api.callsOf('session.create')).toHaveLength(0)
    stopCurrent()

    const noRecent = bench()
    const stopEmpty = noRecent.workspaces.startInitialSelection()
    await noRecent.workspaces.refresh()
    await noRecent.sessions.refresh()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(noRecent.api.callsOf('session.create')).toHaveLength(0)
    expect(() => noRecent.workspaces.startInitialSelection()).toThrow(/already started/)
    stopEmpty()
  })

  it('a failed connect returns to waiting and retries on the next list change', async () => {
    const b = bench()
    b.api.onWorkspaceList = () => Promise.resolve(ok({
      items: [workspace('recent', [], '2026-01-02T00:00:00.000Z')] as never[],
    }))
    b.api.onCreate = () => Promise.resolve(err({ code: 'internal', message: 'attach exploded', details: {} }))
    const stop = b.workspaces.startInitialSelection()
    await b.workspaces.refresh()
    await b.sessions.refresh()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(b.api.callsOf('session.create')).toHaveLength(1)
    expect(b.sessions.list.getSnapshot().current).toBeUndefined()

    // Recovery: the next workspace-list change re-runs the reconcile.
    b.api.onCreate = () => Promise.resolve(ok({ sessionId: sid('s-retry') }))
    await b.workspaces.refresh()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(b.api.callsOf('session.create')).toHaveLength(2)
    expect(b.sessions.list.getSnapshot().current).toBe('s-retry')
    stop()
  })
})
