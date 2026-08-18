// @vitest-environment jsdom
// The Tool presentation package's acceptance chain on the REAL machinery stack:
// SlotTestRuntime (cordis Context + SlotRegistry ledger + the web-react
// renderer) + ui-conversation and ui-tool apply — no outlet twins. Proves the
// keyed 'tool.call.toolview' hole end to end: registered rows dispatch by
// entryKey (the bash sample lands through its plugin), unregistered tools
// fall back to GenericToolCard at the render site, live registration/unload
// flips rows in place, duplicate keys fail loud, the inject channel feeds
// (sessionId) => I into row components, and a registrant can activate before
// the declaration then land through slots.inject when the chat entry appears.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { ISession, SessionId, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as applyConversation, inject as injectConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyTool, inject as injectTool } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
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
// The chat store persists under its declared key; clear between cases.
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

const toolResult = (seq: number, callId: string, name: string, args = '{"command":"make build","description":"Build"}'): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId,
  call: { name, argsRaw: args },
  callTime: seq * 1_000 - 500,
  content: [], isError: false, callView: null, resultView: null, subCalls: [],
})

/** Test-owned AppFrame role: declares and renders the resident conversation area. */
type AppRootProps = PropsRenderSlots<'conversation' | 'details'>
function AppRoot({ renderSlot }: AppRootProps) {
  return <>{renderSlot('conversation', {})}</>
}

const LAYOUT_CHILDREN = {
  'conversation': { kind: 'single', scope: 'session-maybe' },
  'details': { kind: 'single', scope: 'session' },
} as const

/**
 * Real-stack bench: SlotTestRuntime with the session/layout doubles at the
 * service boundaries only, the package apply on its own
 * fiber, and the test AppFrame occupying 'root'.
 */
async function bench(nodes: ToolResultNode[]) {
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
  // ui-theme's Appearance row binds a durable scope through these two.
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  runtime.provide('layout', layout)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.sessions.add({
    id: SID,
    summary: { title: 'S', displayTitle: 'S' },
    snapshot: { nodes, chat: toolChatSnapshot(nodes) },
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
    },
  })
  await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectTool], apply: applyTool })
  return { runtime, slots: runtime.slots, layout }
}

describe('keyed toolview hole through the real machinery', () => {
  it('dispatches registered rows by entryKey and unregistered tools to the GenericToolCard fallback', async () => {
    const b = await bench([
      toolResult(3, 'c1', 'bash'),
      toolResult(4, 'c2', 'mystery', '{"n":1}'),
    ])
    const view = b.runtime.renderRoot()
    // bash: the sample plugin's keyed registration took the row (root
    // session → global arm, decided inside the component off useSessions).
    expect(view.container.querySelector('[data-sample="bash"]')).not.toBeNull()
    expect(view.getByText('Bash')).toBeTruthy()
    expect(view.getByText('Build')).toBeTruthy()
    // mystery: no registration under that key → render-site fallback.
    expect(view.getByText('Tool call')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('renders top-level Cordis calls with lifecycle titles over the generic variants', async () => {
    const b = await bench([
      toolResult(3, 'cordis-1', 'cordis_runtime_inspect', '{"what":"api","name":"tools"}'),
      toolResult(4, 'cordis-2', 'cordis_run', '{"id":"dyn-2"}'),
      toolResult(5, 'cordis-3', 'cordis_stop', '{"id":"dyn-2"}'),
      toolResult(6, 'cordis-4', 'cordis_undefine', '{"id":"dyn-2"}'),
    ])
    const view = b.runtime.renderRoot()

    // Every one of these rows is user-visible on each model define/run, so each
    // names its act and carries the package id rather than falling back to the
    // generic "Tool call · <name> · <id>" row.
    const rowText = (name: string) => view.container.querySelector(`[data-tool="${name}"]`)?.textContent
    expect(rowText('cordis_runtime_inspect')).toContain('Inspect')
    expect(rowText('cordis_run')).toContain('Run Cordis Plugindyn-2')
    expect(rowText('cordis_stop')).toContain('Stop Cordis Plugindyn-2')
    expect(rowText('cordis_undefine')).toContain('Remove Cordis Plugindyn-2')
    // No run-control verb is a code row; the program is cordis_define's, and its
    // own keyed card owns that rendering.
    expect(view.container.querySelector('[data-variant="code"]')).toBeNull()
    await b.runtime.dispose()
  })

  it('file-path clicks travel owner openFile → chat inject → workspaces.openPath', async () => {
    const b = await bench([toolResult(3, 'c1', 'read', '{"path":"src/a.ts"}')])
    const view = b.runtime.renderRoot()
    view.getByText('src/a.ts').click()
    expect(b.layout.openDetails).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(b.runtime.workspaces.calls).toContainEqual({ method: 'openPath', args: ['src/a.ts'] })
    })
    await b.runtime.dispose()
  })

  it('bash summary clicks do not open details or host paths', async () => {
    const b = await bench([toolResult(3, 'c1', 'bash')])
    const view = b.runtime.renderRoot()
    view.getByText('Build').click()
    expect(b.layout.openDetails).not.toHaveBeenCalled()
    expect(b.runtime.workspaces.calls.some(c => c.method === 'openPath')).toBe(false)
    await b.runtime.dispose()
  })

  it('a live keyed registration takes over its tool row and unload reverts to the fallback', async () => {
    const b = await bench([toolResult(3, 'c2', 'mystery', '{"n":1}')])
    const view = b.runtime.renderRoot()
    expect(view.getByText('Tool call')).toBeTruthy()
    let dispose = (): void => {}
    dispose = b.slots.register(
      { name: 'tool.call.toolview', key: 'mystery' },
      () => <div data-testid="mystery-row" />)
    await b.runtime.flush()
    // Per-key version tick: the row flipped without a remount of the view.
    expect(view.getByTestId('mystery-row')).toBeTruthy()
    expect(view.queryByText('Tool call')).toBeNull()
    dispose()
    await b.runtime.flush()
    expect(view.queryByTestId('mystery-row')).toBeNull()
    expect(view.getByText('Tool call')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('a duplicate key registration fails loud at load', async () => {
    const b = await bench([])
    expect(() => b.slots.register(
      { name: 'tool.call.toolview', key: 'bash' },
      () => null,
    )).toThrow(/key "bash"/)
    await b.runtime.dispose()
  })

  it('the inject channel feeds (sessionId) => I into the row component', async () => {
    const b = await bench([toolResult(3, 'c3', 'probe', '{"x":1}')])
    const poked: string[] = []
    b.slots.register({
      name: 'tool.call.toolview',
      key: 'probe',
      // Two-way business face: data derived from the session id out, a
      // callback closing over it back in — the askuser-pattern inject shape.
      inject: (sessionId: SessionId) => ({
        mark: `for:${sessionId}`,
        poke: () => { poked.push(sessionId) },
      }),
    }, ({ mark, poke }: ToolCallViewProps & { mark: string; poke: () => void }) => (
      <button data-testid="probe-row" onClick={poke}>{mark}</button>
    ))
    const view = b.runtime.renderRoot()
    const row = view.getByTestId('probe-row')
    expect(row.textContent).toBe(`for:${SID}`)
    row.click()
    expect(poked).toEqual([SID])
    await b.runtime.dispose()
  })
})

describe('registrant declaration injection', () => {
  it('runs a registrant before ui-tool and waits on the actual toolview declaration', async () => {
    const runtime = await SlotTestRuntime.create()
    runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
    // ui-theme's Appearance row binds a durable scope through these two.
    runtime.provide('remote', { $on: () => () => {} })
    runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)

    // Third-party posture, mounted BEFORE ui-conversation. Plugin apply runs,
    // while slots.inject waits for the declaration itself.
    let applyRuns = 0
    const registrantApply = (registrantCtx: typeof runtime.ctx): void => {
      applyRuns += 1
      registrantCtx.slots.inject('tool.call.toolview', () => registrantCtx.slots.register(
        { name: 'tool.call.toolview', key: 'late' }, () => null))
    }
    const late = runtime.ctx.plugin({
      name: 'late-registrant',
      inject: ['slots'],
      apply: registrantApply,
    })
    await Promise.resolve()
    await late.await()
    expect(applyRuns).toBe(1)
    expect(runtime.slots.entries('tool.call.toolview')).toHaveLength(0)

    // Mounting the package declares the slot and activates the waiting entry.
    await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
    await runtime.mount({ inject: [...injectTool], apply: applyTool })
    expect(runtime.slots.entries('tool.call.toolview').map(e => e.options.key))
      .toEqual(expect.arrayContaining(['bash', 'late']))
    await runtime.dispose()
  })
})
