// @vitest-environment jsdom
/**
 * SlotTestRuntime behavior: root declaration + rendering, session
 * add/update/switch/remove through the real renderer, shared store identity
 * and scope pruning, feature mount/dispose cascade, and runtime disposal
 * idempotence. All through the production SlotRegistry + createSlotRenderer
 * stack — this suite is the fixture the migrated feature specs rely on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '../src/settings-scope.ts'
import { cleanup } from '@testing-library/react'
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'trt.panel': { kind: 'single'; scope: 'root'; owner: { label?: string } }
    'trt.chat': { kind: 'single'; scope: 'session' }
    'trt.rows': { kind: 'list'; scope: 'root' }
    'trt.rows.hole': { kind: 'single'; scope: 'root' }
  }
}

afterEach(cleanup)

type FrameProps = PropsRenderSlots<'trt.panel' | 'trt.chat' | 'trt.rows'>

/** Root frame declaring all three suite slots (render sites for each kind). */
function Frame({ renderSlot, SessionProvider }: FrameProps) {
  return (
    <>
      {renderSlot('trt.panel', { label: 'from-owner' }, { fallback: <i>no panel</i> })}
      <SessionProvider empty={() => <i>no session</i>}>
        {() => renderSlot('trt.chat', {})}
      </SessionProvider>
      {renderSlot('trt.rows', {})}
    </>
  )
}

const CHILDREN = {
  'trt.panel': { kind: 'single', scope: 'root' },
  'trt.chat': { kind: 'single', scope: 'session' },
  'trt.rows': { kind: 'list', scope: 'root' },
} as const

async function runtimeWithFrame() {
  const runtime = await SlotTestRuntime.create()
  await runtime.root.declare(CHILDREN, Frame)
  return runtime
}

describe('root declaration and rendering', () => {
  it('renders declared slots through the real renderer: fallback, then a live registration, then unload', async () => {
    const runtime = await runtimeWithFrame()
    const view = runtime.renderRoot()
    expect(view.container.textContent).toContain('no panel')

    let dispose = (): void => {}
    await runtime.flush() // no-op guard: flush outside mutations is safe
    await (async () => {
      dispose = runtime.slots.register(
        { name: 'trt.panel' },
        ({ label }: { label?: string }) => <b>panel:{label}</b>)
      await runtime.flush()
    })()
    expect(view.container.textContent).toContain('panel:from-owner')
    dispose()
    await runtime.flush()
    expect(view.container.textContent).toContain('no panel')
    await runtime.dispose()
  })

  it('fails loud when rendering with no root declaration (production boot-order check)', async () => {
    const runtime = await SlotTestRuntime.create()
    expect(() => runtime.renderRoot()).toThrow(/'root' has no registration/)
    await runtime.dispose()
  })
})

describe('sessions', () => {
  it('drives SessionProvider: empty state, current session, switch, live snapshot updates', async () => {
    const runtime = await runtimeWithFrame()
    runtime.slots.register({ name: 'trt.chat' }, (props: SessionStandardProps) => {
      const running = props.useSession(s => s.running)
      return <span>chat:{props.sessionId}:{String(running)}</span>
    })
    const view = runtime.renderRoot()
    expect(view.container.textContent).toContain('no session')

    await runtime.sessions.add({ id: 's1' })
    expect(view.container.textContent).toContain('chat:s1:false')

    await runtime.sessions.updateSnapshot('s1', (draft) => { draft.running = true })
    expect(view.container.textContent).toContain('chat:s1:true')

    await runtime.sessions.add({ id: 's2' }) // becomes current by default
    expect(view.container.textContent).toContain('chat:s2:false')

    await runtime.sessions.setCurrent(undefined)
    expect(view.container.textContent).toContain('no session')
    await runtime.sessions.setCurrent('s1')
    expect(view.container.textContent).toContain('chat:s1:true')
    await runtime.dispose()
  })

  it('add with current:false keeps the selection; unknown ids fail loud on the mutators', async () => {
    const runtime = await runtimeWithFrame()
    await runtime.sessions.add({ id: 's1' })
    await runtime.sessions.add({ id: 's2' }, { current: false })
    expect(runtime.sessions.list.getSnapshot().current).toBe('s1')
    expect(runtime.sessions.list.getSnapshot().ids).toEqual(['s1', 's2'])
    await expect(runtime.sessions.add({ id: 's1' })).rejects.toThrow(/already added/)
    await expect(runtime.sessions.setCurrent('ghost')).rejects.toThrow(/not added/)
    await expect(runtime.sessions.updateSnapshot('ghost', () => {})).rejects.toThrow(/not added/)
    await expect(runtime.sessions.remove('ghost')).rejects.toThrow(/not added/)
    expect(() => runtime.sessions.behavior('ghost')).toThrow(/not added/)
    await runtime.dispose()
  })

  it('mints REAL-tag scopes lazily and resolves them through the production scopeOf; bindings expose the behavior face', async () => {
    const runtime = await runtimeWithFrame()
    const prompt = vi.fn()
    await runtime.sessions.add({ id: 's1', session: { prompt } })

    expect(runtime.sessions.provideInfo('ghost')).toBeUndefined()
    expect(runtime.sessions.scope('ghost')).toBeUndefined()
    expect(runtime.sessions.binding('ghost')).toBeUndefined()

    const scope = runtime.sessions.scope('s1')!
    expect(runtime.sessions.scope('s1')).toBe(scope) // stable per session
    expect(runtime.sessions.scopeOf(scope)).toBe('s1')
    expect(runtime.sessions.scopeOf(runtime.ctx)).toBeUndefined()
    // sessionOf resolves the behavior face off the scope tag.
    expect(runtime.sessions.sessionOf(scope)).toBe(runtime.sessions.behavior('s1'))
    expect(runtime.sessions.sessionOf(runtime.ctx)).toBeUndefined()

    const binding = runtime.sessions.binding('s1')!
    expect(binding.sessionId).toBe('s1')
    expect(binding.ctx).toBe(scope)
    ;(binding.session as { prompt: () => void }).prompt()
    expect(prompt).toHaveBeenCalledOnce()
    expect(runtime.sessions.behavior('s1')).toBe(binding.session)
    // The binding's session doubles as the conversation observable face.
    expect((binding.session as { getSnapshot(): { sessionId: string } }).getSnapshot().sessionId).toBe('s1')

    // A scoped service resolves through the scope ctx (scope-addressed pattern).
    runtime.provide('probe', { hello: 'world' })
    expect(scope.get('probe')).toEqual({ hello: 'world' })
    await runtime.dispose()
  })

  it('materializes provide bundles: built-in session hook, custom providers, no-session projection', async () => {
    const runtime = await runtimeWithFrame()
    await runtime.sessions.add({ id: 's1' })

    const info = runtime.sessions.provideInfo('s1')!
    expect(info.sessionId).toBe('s1')
    expect(info.hooks['session']).toBeDefined() // the built-in useSession source
    expect(runtime.sessions.provideInfo('s1')).toBe(info) // identity-stable

    // A feature provider (the ui-conversation input pattern): declared names
    // materialize per session and land in the no-session roster as undefined.
    const off = runtime.sessions.provide({
      hooks: ['probe'],
      props: ['probeActions'],
      resolve: binding => ({
        hooks: { probe: { getSnapshot: () => binding.sessionId, subscribe: () => () => {} } },
        props: { probeActions: { poke: () => {} } },
      }),
    })
    const enriched = runtime.sessions.provideInfo('s1')!
    expect(enriched.hooks['probe']?.getSnapshot()).toBe('s1')
    expect(enriched.props['probeActions']).toBeDefined()
    const maybe = runtime.sessions.maybeProvideInfo(undefined)
    expect(maybe.sessionId).toBeUndefined()
    expect(Object.keys(maybe.hooks)).toEqual(['session', 'probe'])
    expect(runtime.sessions.maybeProvideInfo('s1')).toBe(runtime.sessions.provideInfo('s1'))
    expect(runtime.sessions.maybeProvideInfo('ghost').sessionId).toBeUndefined()

    // Misdeclared providers fail loud AT REGISTRATION (the production
    // channel rebuilds live bundles eagerly and rolls the roster back):
    // missing hook, missing prop, duplicate hook, duplicate prop.
    expect(() => runtime.sessions.provide({ hooks: ['void'], resolve: () => ({}) }))
      .toThrow(/missing hook "void"/)
    expect(() => runtime.sessions.provide({ props: ['void'], resolve: () => ({}) }))
      .toThrow(/missing prop "void"/)
    expect(() => runtime.sessions.provide({
      hooks: ['session'],
      resolve: () => ({ hooks: { session: { getSnapshot: () => 0, subscribe: () => () => {} } } }),
    })).toThrow(/duplicate hook "session"/)
    const propA = runtime.sessions.provide({ props: ['twice'], resolve: () => ({ props: { twice: 1 } }) })
    expect(() => runtime.sessions.provide({ props: ['twice'], resolve: () => ({ props: { twice: 2 } }) }))
      .toThrow(/duplicate prop "twice"/)
    propA()
    // The rejected registrations rolled back: the roster still materializes.
    expect(runtime.sessions.provideInfo('s1')).toBeDefined()
    off()
    off() // disposer is idempotent
    expect(Object.keys(runtime.sessions.maybeProvideInfo(undefined).hooks)).toEqual(['session'])
    await runtime.dispose()
  })

  it('records service-face calls and retains catalog addresses only for addressed selection', async () => {
    const runtime = await runtimeWithFrame()
    await runtime.sessions.add({ id: 's1' })
    await runtime.sessions.add({ id: 's2' })
    const address = {
      parentSessionId: 's2' as SessionId,
      childSessionId: 's1' as SessionId,
      mode: 'continuable' as const,
    }
    runtime.sessions.openSubagent(address)
    await runtime.flush()
    expect(runtime.sessions.list.getSnapshot()).toMatchObject({ current: 's1', currentAddress: address })
    expect(runtime.sessions.subagentAddress('s1' as SessionId)).toEqual(address)
    expect(runtime.sessions.subagentAddress('s2' as SessionId)).toBeUndefined()
    await runtime.sessions.updateSummary('s1', { displayTitle: 'renamed', running: true })
    expect(runtime.sessions.list.getSnapshot().byId['s1' as SessionId])
      .toMatchObject({ displayTitle: 'renamed', running: true })
    runtime.sessions.setSubagentCatalogOpen('s2' as SessionId, true)
    await runtime.sessions.refreshSubagents('s2' as SessionId)
    // The confirmed-switch write-back lands on the row it names and ignores
    // one the fixture never added, exactly as production's list upsert does.
    runtime.sessions.noteAgentPreset('s1' as SessionId, 'minimal')
    runtime.sessions.noteAgentPreset('missing' as SessionId, 'minimal')
    await runtime.flush()
    expect(runtime.sessions.list.getSnapshot().byId['s1' as SessionId])
      .toMatchObject({ agentPreset: 'minimal' })
    runtime.sessions.open('s1' as SessionId)
    await runtime.flush()
    expect(runtime.sessions.list.getSnapshot().current).toBe('s1')
    expect(runtime.sessions.list.getSnapshot().currentAddress).toBeUndefined()
    runtime.sessions.clear()
    await runtime.flush()
    expect(runtime.sessions.list.getSnapshot().current).toBeUndefined()
    await expect(runtime.sessions.fork({
      sessionId: 's1' as SessionId, atSeq: 7, increaseTitle: true,
    })).resolves.toBe('s1')
    expect(runtime.sessions.calls).toEqual([
      { method: 'openSubagent', args: [address] },
      { method: 'setSubagentCatalogOpen', args: ['s2', true] },
      { method: 'refreshSubagents', args: ['s2'] },
      { method: 'open', args: ['s1'] },
      { method: 'clear', args: [] },
      { method: 'fork', args: [{ sessionId: 's1', atSeq: 7, increaseTitle: true }] },
    ])
    await runtime.dispose()
  })

  it('answers search with an empty page until a scenario declares hits, recording every call', async () => {
    const runtime = await runtimeWithFrame()
    await runtime.sessions.add({ id: 's1' })
    const signal = new AbortController().signal
    expect(runtime.sessions.searchResultLimit).toBeGreaterThan(0)
    await expect(runtime.sessions.search('marker', signal))
      .resolves.toEqual({ ok: true, value: { items: [], hasMore: false } })
    runtime.sessions.stubSearch(query => ({
      items: [{ sessionId: 's1' as SessionId, snippet: `hit: ${query}` }],
      hasMore: true,
    }))
    await expect(runtime.sessions.search('marker', signal)).resolves.toEqual({
      ok: true,
      value: { items: [{ sessionId: 's1', snippet: 'hit: marker' }], hasMore: true },
    })
    expect(runtime.sessions.calls).toEqual([
      { method: 'search', args: ['marker', signal] },
      { method: 'search', args: ['marker', signal] },
    ])
    await runtime.dispose()
  })
})

describe('stores', () => {
  const createSuiteStore = () => defineStore({
    init: () => ({ note: '' }),
    persist: 'trt.store',
    actions: { setNote: (d, note: string) => { d.note = note } },
  })

  it('resolves per-session instances via the host face: shared identity, isolation, action-driven re-render', async () => {
    const runtime = await runtimeWithFrame()
    const handle = createSuiteStore()
    runtime.slots.register(
      { name: 'trt.chat', store: handle },
      (props: SessionStandardProps & { useStore: <S>(sel: (s: { note: string }) => S) => S }) =>
        <span>note:{props.useStore(s => s.note)}</span>)
    const view = runtime.renderRoot()
    await runtime.sessions.add({ id: 's1' })

    expect(() => runtime.storeOf('trt.panel')).toThrow(/no registration/)
    const store = runtime.storeOf('trt.chat', 's1')
    await runtime.flush()
    ;(store.actions['setNote'] as (note: string) => void)('hello')
    await runtime.flush()
    expect(view.container.textContent).toContain('note:hello')
    expect(runtime.storeOf('trt.chat', 's1')).toBe(store) // cached per scope key

    await runtime.sessions.add({ id: 's2' })
    const other = runtime.storeOf('trt.chat', 's2')
    expect(other).not.toBe(store)
    expect(other.getSnapshot()).toEqual({ note: '' })
    await runtime.dispose()
  })

  it('storeOf guards: before renderRoot, and for storeless entries', async () => {
    const runtime = await runtimeWithFrame()
    runtime.slots.register({ name: 'trt.panel' }, () => null)
    expect(() => runtime.storeOf('trt.panel')).toThrow(/before renderRoot/)
    runtime.renderRoot()
    expect(() => runtime.storeOf('trt.panel')).toThrow(/declares no store/)
    await runtime.dispose()
  })

  it('remove() prunes the session store scope: persisted state clears, a re-added session starts fresh', async () => {
    const runtime = await runtimeWithFrame()
    const handle = createSuiteStore()
    runtime.slots.register({ name: 'trt.chat', store: handle }, () => null)
    runtime.renderRoot()
    await runtime.sessions.add({ id: 's1' })

    const doomed = runtime.storeOf('trt.chat', 's1')
    ;(doomed.actions['setNote'] as (note: string) => void)('buried')
    expect(localStorage.getItem('trt.store.s1')).not.toBeNull()

    await runtime.sessions.remove('s1')
    expect(localStorage.getItem('trt.store.s1')).toBeNull()
    expect(runtime.sessions.list.getSnapshot().ids).toEqual([])
    expect(runtime.sessions.provideInfo('s1')).toBeUndefined()

    await runtime.sessions.add({ id: 's1' })
    const reborn = runtime.storeOf('trt.chat', 's1')
    expect(reborn).not.toBe(doomed)
    expect(reborn.getSnapshot()).toEqual({ note: '' })
    await runtime.dispose()
  })

  it('remove() also disposes a minted scope fiber; removing a non-current session keeps the selection', async () => {
    const runtime = await runtimeWithFrame()
    await runtime.sessions.add({ id: 's1' })
    await runtime.sessions.add({ id: 's2' }, { current: false })
    const scope = runtime.sessions.scope('s1')!
    await runtime.sessions.remove('s2')
    expect(runtime.sessions.list.getSnapshot().current).toBe('s1')
    await runtime.sessions.remove('s1')
    expect(scope.fiber.uid).toBeNull() // disposed fiber loses its uid
    expect(runtime.sessions.list.getSnapshot().current).toBeUndefined()
    await runtime.dispose()
  })
})

describe('workspaces', () => {
  it('feeds useWorkspaces and records/stubs intent actions', async () => {
    const runtime = await runtimeWithFrame()
    runtime.slots.register(
      { name: 'trt.panel' },
      (props: { useWorkspaces: <S>(sel: (s: { phase: string }) => S) => S }) =>
        <span>ws:{props.useWorkspaces(s => s.phase)}</span>)
    const view = runtime.renderRoot()
    expect(view.container.textContent).toContain('ws:ready')

    await runtime.workspaces.update((draft) => { draft.phase = 'pending' })
    expect(view.container.textContent).toContain('ws:pending')

    runtime.workspaces.startSession('w1' as WorkspaceId)
    await expect(runtime.workspaces.connectWorkspace('w2' as WorkspaceId)).resolves.toBe('session-of-w2')
    expect(runtime.workspaces.calls).toEqual([
      { method: 'startSession', args: ['w1'] },
      { method: 'connectWorkspace', args: ['w2'] },
    ])
    const stub = vi.fn(() => Promise.resolve('other' as never))
    runtime.workspaces.stub('connectWorkspace', stub)
    await expect(runtime.workspaces.connectWorkspace('w3' as WorkspaceId)).resolves.toBe('other')
    expect(stub).toHaveBeenCalledOnce()
    await runtime.dispose()
  })

  it('records the browse calls: listDirectory serves an empty home, createDirectory joins, stubs override', async () => {
    const runtime = await runtimeWithFrame()
    // Defaults: an empty home level and parent/name joining.
    await expect(runtime.workspaces.listDirectory()).resolves.toMatchObject({ path: '/home/test', entries: [] })
    await expect(runtime.workspaces.listDirectory('/home/test')).resolves.toMatchObject({ path: '/home/test' })
    await expect(runtime.workspaces.createDirectory('/home/test', 'fresh')).resolves.toBe('/home/test/fresh')
    // The recorded signal seat mirrors the production face (undefined here;
    // cancellation tests pass and observe a real one).
    expect(runtime.workspaces.calls).toEqual([
      { method: 'listDirectory', args: [undefined, undefined] },
      { method: 'listDirectory', args: ['/home/test', undefined] },
      { method: 'createDirectory', args: ['/home/test', 'fresh'] },
    ])
    // Stubs replace the defaults like every sibling method.
    const listing = { path: '/x', home: '/x', crumbs: [], entries: [] }
    const listStub = vi.fn(() => Promise.resolve(listing as never))
    runtime.workspaces.stub('listDirectory', listStub)
    runtime.workspaces.stub('createDirectory', vi.fn(() => Promise.resolve('/x/made' as never)))
    const scan = new AbortController()
    await expect(runtime.workspaces.listDirectory('/x', scan.signal)).resolves.toBe(listing)
    // The stub receives the signal too, like the production face gives the wire.
    expect(listStub).toHaveBeenLastCalledWith('/x', scan.signal)
    await expect(runtime.workspaces.createDirectory('/x', 'made')).resolves.toBe('/x/made')
    await runtime.dispose()
  })
})

describe('feature mount and disposal', () => {
  it('mounts a plugin on a real fiber; dispose() cascades entries, declared children, and services', async () => {
    const runtime = await runtimeWithFrame()
    runtime.provide('layout', { openDetails: vi.fn() })
    const feature = await runtime.mount({
      inject: ['slots', 'layout'],
      apply: (ctx: typeof runtime.ctx) => {
        ctx.provide('feature-service', { ok: true })
        ctx.slots.register({
          name: 'trt.rows',
          id: 'row-1',
          children: { 'trt.rows.hole': { kind: 'single', scope: 'root' } },
        } as never, ((props: { renderSlot: (key: string, owner: object) => unknown }) =>
          <div data-testid="row">{props.renderSlot('trt.rows.hole', {}) as React.ReactNode}</div>) as never)
      },
    })
    const view = runtime.renderRoot()
    expect(view.getByTestId('row')).toBeTruthy()
    expect(runtime.ctx.get('feature-service')).toEqual({ ok: true })
    expect(runtime.slots.entries('trt.rows')).toHaveLength(1)

    await feature.dispose()
    await feature.dispose() // idempotent
    expect(runtime.slots.entries('trt.rows')).toHaveLength(0)
    expect(runtime.slots.spec('trt.rows.hole')).toBeUndefined()
    expect(runtime.ctx.get('feature-service')).toBeUndefined()
    expect(view.queryByTestId('row')).toBeNull()
    await runtime.dispose()
  })

  it('mount fails loud on missing services instead of suspending forever', async () => {
    const runtime = await runtimeWithFrame()
    await expect(runtime.mount({ inject: ['slots', 'absent-service'], apply: () => {} }))
      .rejects.toThrow(/missing service\(s\) absent-service/)
    await runtime.dispose()
  })

  it('runtime dispose is idempotent, unmounts views, disposes mounted features, and clears persisted state', async () => {
    const runtime = await runtimeWithFrame()
    const feature = await runtime.mount({
      inject: ['slots'],
      apply: (ctx: typeof runtime.ctx) => { ctx.slots.register({ name: 'trt.panel' }, () => <b>p</b>) },
    })
    const view = runtime.renderRoot()
    expect(view.container.textContent).toContain('p')
    localStorage.setItem('trt.leftover', 'x')

    await runtime.dispose()
    expect(view.container.innerHTML).toBe('')
    expect(feature.fiber.uid).toBeNull()
    expect(localStorage.getItem('trt.leftover')).toBeNull()
    await runtime.dispose() // idempotent
    await expect(runtime.dispose()).resolves.toBeUndefined()
  })
})

describe('single-slot mounting (declare + renderSlot)', () => {
  it('renders one slot inside its data-slot wrapper and updates owner props in place', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.panel': { kind: 'single', scope: 'root' } })
    runtime.slots.register(
      { name: 'trt.panel' },
      ({ label }: { label?: string }) => <b data-testid="panel">{label ?? 'none'}</b>)
    const slot = runtime.renderSlot('trt.panel', { label: 'first' })
    expect(slot.container.getAttribute('data-slot')).toBe('trt.panel')
    expect(slot.view.getByTestId('panel').textContent).toBe('first')

    const panel = slot.view.getByTestId('panel')
    slot.update({ label: 'second' })
    expect(slot.view.getByTestId('panel').textContent).toBe('second')
    // In-place re-render: the element identity survived the owner flip.
    expect(slot.view.getByTestId('panel')).toBe(panel)
    await runtime.dispose()
  })

  it('views sibling slots of one tree separately and rejects undeclared keys', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({
      'trt.panel': { kind: 'single', scope: 'root' },
      'trt.rows': { kind: 'list', scope: 'root' },
    })
    runtime.slots.register({ name: 'trt.panel' }, () => <b>panel</b>)
    runtime.slots.register({ name: 'trt.rows', id: 'r1' }, () => <i>row</i>)
    const panel = runtime.renderSlot('trt.panel', {})
    const rows = runtime.renderSlot('trt.rows', {})
    expect(panel.container.textContent).toBe('panel')
    expect(rows.container.textContent).toBe('row')
    expect(() => runtime.renderSlot('trt.chat', {})).toThrow(/without declare\(\)/)
    await runtime.dispose()
  })

  it('folds class hashes and collapses svg internals in snapshots, leaving the live DOM alone', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.panel': { kind: 'single', scope: 'root' } })
    runtime.slots.register({ name: 'trt.panel' }, () => (
      <div className="_frame_a1b2c3 plain">
        <span className="_label_ff00aa">styled</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M0 0L16 16" fill="currentColor" />
        </svg>
      </div>
    ))
    const slot = runtime.renderSlot('trt.panel', {})
    expect(slot.container).toMatchSnapshot()
    // The serializer works on a clone: the live DOM keeps hashes and paths.
    expect(slot.container.querySelector('div')!.className).toBe('_frame_a1b2c3 plain')
    expect(slot.container.querySelector('svg path')).not.toBeNull()
    await runtime.dispose()
  })
})

describe('fixture session face', () => {
  it('fail-loud stubs name the missing verb; supplied overrides run instead', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.sessions.add({ id: 's1' })
    const bare = runtime.sessions.behavior('s1')
    expect(() => bare.prompt()).toThrow(/prompt is not stubbed/)
    expect(() => bare.readAttachment('att-1' as Parameters<typeof bare.readAttachment>[0])).toThrow(/readAttachment is not stubbed/)
    expect(() => bare.updateQueue()).toThrow(/updateQueue is not stubbed/)
    expect(() => bare.cancel()).toThrow(/cancel is not stubbed/)
    expect(() => bare.command()).toThrow(/command is not stubbed/)
    expect(() => bare.loadOlder()).toThrow(/loadOlder is not stubbed/)
    expect(() => bare.rename()).toThrow(/rename is not stubbed/)
    await runtime.dispose()
  })

  it('projections faces are identity-stable per key, read absent, and notify on set', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.sessions.add({ id: 's1' })
    const session = runtime.sessions.behavior('s1')
    const face = session.projections.faceOf('todos')
    expect(session.projections.faceOf('todos')).toBe(face)
    expect(face.getSnapshot()).toBeUndefined()
    const seen: unknown[] = []
    const off = face.subscribe(() => { seen.push(face.getSnapshot()) })
    session.projections.set('todos', [1, 2])
    expect(seen).toEqual([[1, 2]])
    off()
    session.projections.set('todos', [3])
    expect(seen).toEqual([[1, 2]]) // unsubscribed
    // A never-subscribed key sets without listeners (the empty-notify arm).
    session.projections.set('untouched', 1)
    // The provide bundle hands the same store to the render side.
    const info = runtime.sessions.provideInfo('s1')!
    expect(info.projections?.faceOf('todos').getSnapshot()).toEqual([3])
    // A roster change rebuilds the ALREADY-materialized bundle eagerly
    // (production channel semantics: mounted entries must see the provider)
    // and skips never-materialized records (they pick the roster up lazily).
    await runtime.sessions.add({ id: 's-lazy' }, { current: false })
    const offProbe = runtime.sessions.provide({
      hooks: ['probe2'],
      resolve: () => ({ hooks: { probe2: { getSnapshot: () => 1, subscribe: () => () => {} } } }),
    })
    const rebuilt = runtime.sessions.provideInfo('s1')!
    expect(rebuilt).not.toBe(info)
    expect(rebuilt.hooks['probe2']).toBeDefined()
    offProbe()
    await runtime.dispose()
  })
})

describe('workspaces action face', () => {
  it('records every IWorkspaces verb with inert defaults and honors stubs', async () => {
    const runtime = await SlotTestRuntime.create()
    const ws = runtime.workspaces
    const created = await ws.create({ path: '/tmp/alpha' })
    expect(created.title).toBe('/tmp/alpha')
    const registered = await ws.create({ path: '/tmp/beta' })
    expect(registered.path).toBe('/tmp/beta')
    await expect(ws.pickDirectory()).resolves.toBeNull()
    const renamed = await ws.rename('w1' as WorkspaceId, 'Renamed')
    expect(renamed.title).toBe('Renamed')
    await ws.delete('w1' as WorkspaceId)
    await ws.openPath('/proj/file.ts')
    await ws.insertBefore('w1' as WorkspaceId, 'w2' as WorkspaceId)
    const moved = await ws.insertSessionBefore('w1' as WorkspaceId, 's1' as SessionId, 's2' as SessionId)
    expect(moved.sessionIds).toEqual(['s1'])
    // Default archive mirrors the production effect: the id joins the list
    // state's archive set (features render against the same snapshot).
    await ws.archiveSession('s1' as SessionId)
    expect(ws.list.getSnapshot().archivedSessionIds).toEqual(['s1'])
    expect(ws.calls.map(c => c.method)).toEqual(
      ['create', 'create', 'pickDirectory', 'rename', 'delete', 'openPath', 'insertBefore', 'insertSessionBefore', 'archiveSession'])

    ws.stub('create', () => Promise.resolve({ workspaceId: 'ws-x', title: 'X', path: '/x', sessionIds: [] } as never))
    ws.stub('pickDirectory', () => Promise.resolve('/picked'))
    ws.stub('rename', () => Promise.resolve({ workspaceId: 'w1', title: 'S', path: '/s', sessionIds: [] } as never))
    ws.stub('delete', () => Promise.resolve())
    ws.stub('openPath', () => Promise.resolve())
    const insertBefore = vi.fn(() => Promise.resolve())
    ws.stub('insertBefore', insertBefore)
    ws.stub('insertSessionBefore', () => Promise.resolve({ workspaceId: 'w1', title: '', path: '', sessionIds: [] } as never))
    ws.stub('archiveSession', () => Promise.resolve())
    expect((await ws.create({ path: '/y' })).title).toBe('X')
    await expect(ws.pickDirectory()).resolves.toBe('/picked')
    expect((await ws.rename('w1' as WorkspaceId, 'z')).title).toBe('S')
    await ws.delete('w1' as WorkspaceId)
    await ws.openPath('/other')
    await ws.insertBefore('w2' as WorkspaceId)
    expect(insertBefore).toHaveBeenCalledWith('w2', undefined)
    expect((await ws.insertSessionBefore('w1' as WorkspaceId, 's1' as SessionId)).sessionIds).toEqual([])
    // The stub replaces the default set mutation: the set stays as-is.
    await ws.archiveSession('s2' as SessionId)
    expect(ws.list.getSnapshot().archivedSessionIds).toEqual(['s1'])
    await runtime.dispose()
  })
})

describe('single-slot mounting edge arms', () => {
  it('renderSlot fails loud after dispose and after an external unmount', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.panel': { kind: 'single', scope: 'root' } })
    runtime.slots.register({ name: 'trt.panel' }, () => <b>p</b>)
    runtime.renderSlot('trt.panel', {})
    // RTL cleanup empties the mounted tree behind the runtime's back: the
    // wrapper lookup names the state instead of returning a dead container.
    cleanup()
    expect(() => runtime.renderSlot('trt.panel', {})).toThrow(/rendered no wrapper/)
    await runtime.dispose()
    // After dispose the root registration is gone: the production boot-order
    // check fires before any wrapper lookup.
    expect(() => runtime.renderSlot('trt.panel', {})).toThrow(/'root' has no registration/)
  })

  it('serializes childless svg untouched next to scoped classes', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.panel': { kind: 'single', scope: 'root' } })
    runtime.slots.register({ name: 'trt.panel' }, () => (
      <div className="_frame_a1b2c3">
        <svg viewBox="0 0 1 1" aria-hidden="true" />
      </div>
    ))
    const slot = runtime.renderSlot('trt.panel', {})
    expect(slot.container).toMatchSnapshot()
    await runtime.dispose()
  })
})

describe('stubbed settings scope', () => {
  it('records both write kinds and publishes a Host acceptance to its listeners', async () => {
    const host = stubSettingsScope<{ preference: string }>()
    let notified = 0
    const stop = host.scope.subscribe(() => { notified += 1 })
    expect(host.listenerCount()).toBe(1)
    expect(host.scope.getSnapshot()).toMatchObject({
      status: 'loading', base: undefined, user: undefined,
    })

    await host.scope.set('preference', 'dark')
    await host.scope.unset('preference')
    host.publish({
      status: 'ready',
      value: { preference: 'system' },
      base: { preference: 'system' },
      revision: 2,
      writable: true,
    })

    expect(host.set).toHaveBeenCalledWith('preference', 'dark')
    expect(host.unset).toHaveBeenCalledWith('preference')
    expect(notified).toBe(1)
    expect(host.scope.getSnapshot()).toMatchObject({ status: 'ready', revision: 2, writable: true })
    stop()
    expect(host.listenerCount()).toBe(0)
  })
})
