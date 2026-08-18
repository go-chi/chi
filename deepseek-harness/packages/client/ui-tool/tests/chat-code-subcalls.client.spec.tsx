// @vitest-environment jsdom
// Code Mode sub-call acceptance on the REAL machinery stack (same bench as
// chat-toolview-slot.spec): a run_code result renders the 'code' variant row
// (description summary, program body), its logged sub-dispatches render as
// always-visible nested rows through the SAME keyed toolview hole — the bash
// sub-call lands in the bash sample plugin's registration exactly like a
// top-level bash row, unregistered sub-tools fall back to GenericToolCard —
// and a file sub-row click opens the host path. Running parents
// (runningCalls) nest their so-far dispatches the same way.

import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import {
  ConversationEventRegistry, ConversationViewRegistry, createSnapshotStore,
  EMPTY_CONVERSATION_VIEWS, SlotRegistry,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, RunningToolCall, SessionId, SessionListState,
  ToolCallBlock, ToolResultNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSlotRenderer } from '@deepseek-ai/dsh-client-web-react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as applyConversation, inject as injectConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyTool, inject as injectTool } from '../src/client/apply.ts'
import { toolChatSnapshot } from './tool-details-render.client.tsx'

const SID = 's1' as SessionId

/** jsdom has no ResizeObserver; the composer seat publishes its height through one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

const PROGRAM = 'const listing = await tools.bash({ command: "ls notes", description: "List notes" })\nreturn listing'
const RUN_CODE_ARGS = JSON.stringify({ code: PROGRAM, description: 'List the notes directory' })

const codeResult = (seq: number, callId: string): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId,
  call: { name: 'run_code', argsRaw: RUN_CODE_ARGS },
  callTime: seq * 1_000 - 500,
  content: [{ type: 'text', text: 'demo.txt' }], isError: false, callView: null, resultView: null,
  subCalls: [],
})

const runningCode = (callId: string): RunningToolCall => ({
  callId, name: 'run_code', argsRaw: RUN_CODE_ARGS, turn: 9, step: 0, time: 9_000, callView: null,
  subCalls: [],
})

const subCall = (
  seq: number, parent: string, n: number, name: string, args: object, resultText: string, isError = false,
): ToolCallBlock => ({
  kind: 'tool-result', seq, time: seq * 1_000,
  callId: `${parent}:code:${n}`,
  call: { name, argsRaw: JSON.stringify(args) },
  callTime: seq * 1_000,
  content: [{ type: 'text', text: resultText }], isError, callView: null, resultView: null,
  subCalls: [],
})

function snapshotWith(
  nodes: ToolResultNode[],
  subCalls: readonly ToolCallBlock[],
  runningCalls: RunningToolCall[] = [],
): ConversationSnapshot {
  const nestedNodes = nodes.map(node => ({ ...node, subCalls }))
  const nestedRunningCalls = runningCalls.map(call => ({ ...call, subCalls }))
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS,
    chat: toolChatSnapshot(nestedNodes, nestedRunningCalls),
    nodes: nestedNodes, turnTimings: new Map(), turnEnds: new Map(), partial: null,
    runningCalls: nestedRunningCalls,
    pending: [], queue: [], running: runningCalls.length > 0, composerPhase: 'active', removed: false,
    openState: 'open', openError: null,
    hasMore: false, loadingOlder: false, promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

/** Test-owned AppFrame role: declares and renders the resident conversation area. */
type AppRootProps = PropsRenderSlots<'conversation' | 'details'>
function AppRoot({ renderSlot }: AppRootProps) {
  return <>{renderSlot('conversation', {})}</>
}

/**
 * Same real-stack bench as the toolview-slot spec: SlotRegistry + renderer +
 * both owning package applies; fakes only at service boundaries.
 */
async function bench(snapshot: ConversationSnapshot) {
  const ctx = new Context()
  const slotsFiber = ctx.plugin(SlotRegistry)
  await slotsFiber.await()
  await ctx.plugin(ConversationEventRegistry).await()
  await ctx.plugin(ConversationViewRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry

  const session = createSnapshotStore<ConversationSnapshot>(snapshot)
  const list = createSnapshotStore<SessionListState>({
    ids: [SID],
    byId: { [SID]: { id: SID, title: 'S', displayTitle: 'S', running: false, blank: false, updatedAt: 1 } },
    current: SID,
    phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const scoped = { send: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  // Provide-channel contributions land in this bundle the way the runtime
  // materializes them; the renderer host serves it through provideInfo.
  const provided: { hooks: Record<string, unknown>; props: Record<string, unknown> } = { hooks: {}, props: {} }
  // Identity-stable currentProvideInfo snapshot (uSES getSnapshot contract),
  // materialized on first render after the provide contributions landed.
  let infoCell: { sessionId: SessionId; hooks: Record<string, unknown>; props: Record<string, unknown> } | undefined
  const sessionsFake = {
    list,
    binding: (id: SessionId) => (id === SID
      ? { sessionId: SID, session, ctx: { effect: () => {}, on: () => () => {} } }
      : undefined),
    scope: () => ({ get: () => scoped }),
    scopeOf: () => SID,
    provide: (descriptor: { resolve: (binding: unknown) => { hooks?: Record<string, unknown>; props?: Record<string, unknown> } }) => {
      const contribution = descriptor.resolve(sessionsFake.binding(SID))
      Object.assign(provided.hooks, contribution.hooks ?? {})
      Object.assign(provided.props, contribution.props ?? {})
      return () => {}
    },
    provideInfo: (id: string) => (id === SID
      ? { sessionId: SID, hooks: { session, ...provided.hooks }, props: provided.props }
      : undefined),
    currentProvideInfo: {
      getSnapshot: () => infoCell ??= { sessionId: SID, hooks: { session, ...provided.hooks }, props: provided.props },
      subscribe: () => () => {},
    },
    create: vi.fn(),
    open: vi.fn(),
  }
  ctx.provide('sessions', sessionsFake)
  const workspaces = {
    list: createSnapshotStore<WorkspaceListState>({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: undefined,
    }),
    startSession: vi.fn(),
    sendSession: vi.fn(),
    openPath: vi.fn(async () => {}),
  }
  ctx.provide('workspaces', workspaces)
  ctx.provide('layout', layout)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  // ui-theme's Appearance row binds a durable scope through these two.
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  slots.installLocale(locale)

  slots.install(createSlotRenderer())
  slots.register({
    name: 'root',
    children: {
      'conversation': { kind: 'single', scope: 'session-maybe' },
      'details': { kind: 'single', scope: 'session' },
    },
  }, AppRoot)

  const fiber = ctx.plugin({ inject: [...injectConversation], apply: applyConversation })
  await fiber.await()
  const toolFiber = ctx.plugin({ inject: [...injectTool], apply: applyTool })
  await toolFiber.await()
  return { ctx, slots, fiber, toolFiber, session, layout, workspaces }
}

function mountApp(slots: SlotRegistry) {
  return render(<>{slots.renderSlot('root', {})}</>)
}

describe('run_code sub-calls through the real chat machinery', () => {
  it('renders the code-variant parent row with the description summary and nested sub-rows', async () => {
    const parent = 'call-64'
    const subCalls = [
      subCall(11, parent, 1, 'bash', { command: 'ls notes', description: 'List notes' }, 'demo.txt'),
      subCall(12, parent, 2, 'mystery', { n: 1 }, 'ok'),
    ]
    const b = await bench(snapshotWith([codeResult(10, parent)], subCalls))
    const view = mountApp(b.slots)

    // Parent row: the code variant with the model-authored description.
    const codeRoot = view.container.querySelector('[data-variant="code"]')
    expect(codeRoot).not.toBeNull()
    expect(view.getByText('Code')).toBeTruthy()
    expect(view.getByText('List the notes directory')).toBeTruthy()

    // Nested rows are ALWAYS visible (no parent expand needed): the bash
    // sub-call landed in the bash sample plugin's keyed registration — Bash ·
    // description chrome, same as a top-level bash row — and the unregistered
    // sub-tool fell back to GenericToolCard at the same render site.
    const nest = view.container.querySelector('[data-subcalls]')
    expect(nest).not.toBeNull()
    expect(nest!.querySelector('[data-sample="bash"]')).not.toBeNull()
    expect(view.getByText('Bash')).toBeTruthy()
    expect(view.getByText('List notes')).toBeTruthy()
    expect(view.getByText('Tool call')).toBeTruthy()
  })

  it('renders Cordis sub-calls with lifecycle titles over the generic variants', async () => {
    const parent = 'call-cordis'
    const subCalls = [
      subCall(11, parent, 1, 'cordis_runtime_inspect', { what: 'temporary' }, '## Dynamic Packages'),
      subCall(12, parent, 2, 'cordis_run', { id: 'dyn-2' }, 'Dynamic package dyn-2 is running'),
      subCall(13, parent, 3, 'cordis_undefine', { id: 'dyn-2' }, 'Dynamic package dyn-2 was discarded.'),
    ]
    const b = await bench(snapshotWith([codeResult(10, parent)], subCalls))
    const view = mountApp(b.slots)
    const nest = view.container.querySelector('[data-subcalls]')!

    // Each run-control verb names its act and shows the package id; without the
    // owned titles all three would read "Tool call · cordis_run · dyn-2".
    expect(nest.querySelector('[data-tool="cordis_runtime_inspect"]')?.textContent).toContain('Inspect')
    expect(nest.querySelector('[data-tool="cordis_run"]')?.textContent).toContain('Run Cordis Plugindyn-2')
    expect(nest.querySelector('[data-tool="cordis_undefine"]')?.textContent).toContain('Remove Cordis Plugindyn-2')
    // None of them is a code row: the program belongs to cordis_define, whose
    // own keyed card renders it (the next case covers the code row itself).
    expect(nest.querySelector('[data-variant="code"]')).toBeNull()
  })

  it('expanding the code row reveals the program body verbatim (shiki-tokenized)', async () => {
    const parent = 'call-64'
    const b = await bench(snapshotWith([codeResult(10, parent)], []))
    const view = mountApp(b.slots)
    // The code row is expandable via the whole summary row (body = the program).
    const toggle = view.container.querySelector('[data-variant="code"] [data-expandable]')
    expect(toggle).not.toBeNull()
    fireEvent.click(toggle!)
    // Shiki splits the program into token spans inside one <pre class="shiki">:
    // assert the whole text and the highlighted tree rather than one node.
    const pre = view.container.querySelector('pre.shiki')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toContain('const listing = await tools.bash')
    expect(pre!.querySelectorAll('span[style]').length).toBeGreaterThan(3)
  })

  it('an isError sub-call renders the error state dot exactly like a failed native row', async () => {
    const parent = 'call-64'
    const subCalls = [
      subCall(11, parent, 1, 'mystery', { n: 1 }, 'Error: boom', true),
    ]
    const b = await bench(snapshotWith([codeResult(10, parent)], subCalls))
    const view = mountApp(b.slots)
    const nested = view.container.querySelector('[data-subcalls] [data-variant][data-state="error"]')
    expect(nested).not.toBeNull()
  })

  it('a file sub-row click opens the host path; bash sub-rows do not open details', async () => {
    const parent = 'call-64'
    const subCalls = [
      subCall(11, parent, 1, 'read', { path: 'notes/demo.txt' }, 'ok'),
      subCall(12, parent, 2, 'bash', { command: 'ls notes', description: 'List notes' }, 'demo.txt'),
    ]
    const b = await bench(snapshotWith([codeResult(10, parent)], subCalls))
    const view = mountApp(b.slots)
    view.getByText('notes/demo.txt').click()
    expect(b.layout.openDetails).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(b.workspaces.openPath).toHaveBeenCalledWith('notes/demo.txt')
    })
    view.getByText('List notes').click()
    expect(b.layout.openDetails).not.toHaveBeenCalled()
  })

  it('a RUNNING run_code call nests its so-far dispatches under the spinner row', async () => {
    const parent = 'call-live'
    const subCalls = [
      subCall(21, parent, 1, 'bash', { command: 'ls notes', description: 'List notes' }, 'demo.txt'),
    ]
    const b = await bench(snapshotWith([], subCalls, [runningCode(parent)]))
    const view = mountApp(b.slots)
    const running = view.container.querySelector('[data-variant="code"][data-state="running"]')
    expect(running).not.toBeNull()
    const nest = view.container.querySelector('[data-subcalls]')
    expect(nest).not.toBeNull()
    expect(nest!.querySelector('[data-sample="bash"]')).not.toBeNull()
  })

  it('a started-but-unsettled sub-call renders the running state exactly like a native in-flight row', async () => {
    const parent = 'call-live'
    const runningSub: ToolCallBlock = {
      callId: `${parent}:code:1`, name: 'grep', argsRaw: '{"pattern":"todo"}',
      turn: 0, step: 0, time: 21_000, callView: null, subCalls: [],
    }
    const b = await bench(snapshotWith([], [runningSub], [runningCode(parent)]))
    const view = mountApp(b.slots)
    // The nested row derives 'running' from the RunningToolCall shape — the
    // same data-state chrome (row sweep) a native in-flight row wears.
    const nested = view.container.querySelector('[data-subcalls] [data-variant][data-state="running"]')
    expect(nested).not.toBeNull()
  })

  it('an ordinary tool row renders no sub-call nest', async () => {
    const parent = 'call-64'
    const plain: ToolResultNode = {
      kind: 'tool-result', seq: 10, time: 10_000, callId: parent,
      call: { name: 'mystery', argsRaw: '{"n":1}' },
      callTime: 9_500,
      content: [], isError: false, callView: null, resultView: null, subCalls: [],
    }
    const b = await bench(snapshotWith([plain], []))
    const view = mountApp(b.slots)
    expect(view.container.querySelector('[data-subcalls]')).toBeNull()
  })
})
