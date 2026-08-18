// @vitest-environment jsdom
// The read render intent on the web side: the pure readCardModel derivation
// over the settled result view, and both conversation render sites that consume
// it — the chat tool row (the keyed ReadRow and the GenericToolCard fallback,
// each composing ToolRow with the read card as its collapsed-by-default expanded
// body) and the details panel's Output section (resident, full height). Also
// pins the keyed 'read' toolview registration.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import {
  createSnapshotStore, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type {
  ConversationSnapshot, RunningToolCall, SessionId, SessionListState, ToolResultNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SelectionTarget } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CHAT_READ_MAX_LINES, readCardModel } from '../src/client/tool/models/read-card-model.ts'
import { createChatStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import { GenericToolCard, type GenericToolCardProps } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { DetailsPanel } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/DetailsPanel.tsx'
import { ReadRow, readToolview } from '../src/client/tool/toolviews/read-row.tsx'
import { renderToolDetails, SessionProviderStub, toolChatSnapshot } from './tool-details-render.client.tsx'

afterEach(cleanup)

const SID = 's1' as SessionId

/** The chat-view locale seat: this package's namespace over the common fallback. */
const t: GenericToolCardProps['t'] = makeTranslate(zh, commonZh)

// The read tool's real schema key is `file_path`; the top-level read samples
// use it so the row exercises a production-shaped call. `web_fetch` (below) has
// its own schema whose key is not `file_path`, so it keeps a `url`-less `path`.
const ARGS = '{"file_path":"src/a.ts","offset":41}'
const WEB_FETCH_ARGS = '{"path":"src/a.ts","offset":41}'

/** The read block's rendered content cells, one string per row (highlighting
 *  breaks a line across token spans, so match on the row's textContent). */
function contentTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-read] [class^="_content_"]')].map(cell => cell.textContent ?? '')
}

/** Three windowed lines starting at file line 41 (a read past an offset). */
const sampleLines = [
  { number: 41, text: 'export const a = 1' },
  { number: 42, text: 'export const b = 2' },
  { number: 43, text: 'export const c = 3' },
]

/** The read tool's own result view for a settled file read. */
const resultRead = (over?: Partial<Extract<ToolResultView, { card: 'read' }>>): ToolResultView => ({
  card: 'read', path: 'src/a.ts', offset: 41, lines: sampleLines, totalLines: 180, lang: 'ts', ...over,
})

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'read', argsRaw: ARGS,
  turn: 1, step: 1, time: 1_000, callView: { card: 'generic', title: 'Read src/a.ts', kind: 'read' }, subCalls: [], ...over,
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'read', argsRaw: ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: '41: export const a = 1' }], isError: false,
  callView: { card: 'generic', title: 'Read src/a.ts', kind: 'read' }, resultView: resultRead(), subCalls: [], ...over,
})

describe('readCardModel', () => {
  it('derives the card from a settled read result view', () => {
    expect(readCardModel(settled())).toEqual({
      label: 'src/a.ts', lines: sampleLines, totalLines: 180, lang: 'ts',
    })
  })

  it('copies the lines into the primitive shape rather than aliasing the frozen slice', () => {
    const model = readCardModel(settled())
    expect(model?.lines).toEqual(sampleLines)
    expect(model?.lines).not.toBe(sampleLines)
    expect(model?.lines[0]).not.toBe(sampleLines[0])
  })

  it('takes the result view\'s replacement title over the relativized path', () => {
    // The presentation contract defines a result title as REPLACING the pending
    // one, so a tool that supplies a label wins over the path here.
    expect(readCardModel(settled({ resultView: resultRead({ title: 'Read (head) src/a.ts' }) }))?.label)
      .toBe('Read (head) src/a.ts')
  })

  it('relativizes a workspace-rooted path label, and leaves others as authored', () => {
    // A workspace-rooted absolute path shows its short form.
    expect(readCardModel(settled({ resultView: resultRead({ path: '/w/app/src/a.ts' }) }), '/w/app')?.label)
      .toBe('src/a.ts')
    // A path outside the workspace stays as authored.
    expect(readCardModel(settled({ resultView: resultRead({ path: '/srv/other.ts' }) }), '/w/app')?.label)
      .toBe('/srv/other.ts')
    // With no session cwd there is nothing to relativize against.
    expect(readCardModel(settled({ resultView: resultRead({ path: '/w/app/src/a.ts' }) }))?.label)
      .toBe('/w/app/src/a.ts')
  })

  it('carries an omitted language through as undefined', () => {
    const noLang = resultRead()
    delete (noLang as { lang?: string }).lang
    expect(readCardModel(settled({ resultView: noLang }))?.lang).toBeUndefined()
  })

  it('returns null for a running read: the read intent is result-side only', () => {
    // A read carries no content until execute returns, so the pending call is a
    // generic card and there is no read card to draw yet.
    expect(readCardModel(running())).toBeNull()
  })

  it('returns null for every non-read settled call: no view, generic view, unknown card', () => {
    expect(readCardModel(settled({ resultView: null }))).toBeNull()
    expect(readCardModel(settled({ resultView: { card: 'generic' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire; the
    // documented generic-card default takes it, not a crash.
    const future = { card: 'chart' } as unknown as ToolResultView
    expect(readCardModel(settled({ resultView: future }))).toBeNull()
  })
})

describe('GenericToolCard read body', () => {
  const ownerProps = (block: RunningToolCall | ToolResultNode): GenericToolCardProps => ({
    callId: 'c1', toolName: 'web_fetch', block, openFile: vi.fn(), t,
  })

  /** The whole summary row is the expand toggle (ToolRow's unified interaction). */
  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('expands to the read card, capped tighter than the panel', () => {
    expect(CHAT_READ_MAX_LINES).toBeLessThan(16)
    // web_fetch lands on the read variant without its own keyed row, so the
    // fallback card owns the read block once expanded.
    const view = render(<GenericToolCard {...ownerProps(settled({ call: { name: 'web_fetch', argsRaw: WEB_FETCH_ARGS } }))} />)
    // Collapsed: no read card in the DOM yet.
    expect(view.container.querySelector('[data-read]')).toBeNull()
    toggleRow(view)
    expect(view.container.querySelector('[data-read]')).not.toBeNull()
    expect(contentTexts(view.container)).toContain('export const a = 1')
    // The gutter keeps the file's own line numbers.
    expect(view.getByText('41')).toBeTruthy()
  })

  it('a non-read tool renders the bare row with no read card', () => {
    const view = render(<GenericToolCard {...({
      callId: 'c1', toolName: 'echo', block: settled({
        call: { name: 'echo', argsRaw: '{"text":"x"}' }, callView: null, resultView: null,
      }), openFile: vi.fn(), t,
    })} />)
    toggleRow(view)
    expect(view.container.querySelector('[data-read]')).toBeNull()
  })

  it('a running read renders the summary row alone (no result view yet)', () => {
    const view = render(<GenericToolCard {...ownerProps(running({ name: 'web_fetch' }))} />)
    expect(view.container.querySelector('[data-read]')).toBeNull()
  })
})

describe('ReadRow keyed toolview', () => {
  const list = () => createSnapshotStore<SessionListState>({
    ids: [SID],
    byId: { [SID]: { id: SID, displayTitle: 'r', running: false, blank: false, updatedAt: 0, cwd: '/w/app' } },
    current: SID,
    phase: 'ready',
    subagentsByParent: {}, jobsBySession: {},
    currentAddress: undefined,
  })

  const rowProps = (block: RunningToolCall | ToolResultNode): Parameters<typeof ReadRow>[0] => ({
    callId: 'c1', toolName: 'read', block, openFile: vi.fn(),
    sessionId: SID, useSessions: bindSnapshotSelector(list()),
    t,
  } as unknown as Parameters<typeof ReadRow>[0])

  /** The whole summary row is the expand toggle (ToolRow's unified interaction). */
  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('collapses to the path summary; the whole row toggles the read card', () => {
    const view = render(<ReadRow {...rowProps(settled())} />)
    expect(view.getByText('Read')).toBeTruthy()
    // Collapsed: the path is the summary link alone, and the card is absent.
    expect(view.getAllByText('src/a.ts').length).toBe(1)
    expect(view.container.querySelector('[data-read]')).toBeNull()
    toggleRow(view)
    // Expanded: the summary link stays inline and the card's banner label adds a
    // second occurrence of the path.
    expect(view.getAllByText('src/a.ts').length).toBe(2)
    expect(view.container.querySelector('[data-read]')).not.toBeNull()
    expect(contentTexts(view.container)).toContain('export const a = 1')
    expect(view.getByText('显示 3 / 180 行')).toBeTruthy()
    // Collapse back in place: the card unmounts, the summary link returns.
    toggleRow(view)
    expect(view.container.querySelector('[data-read]')).toBeNull()
    expect(view.getAllByText('src/a.ts').length).toBe(1)
  })

  it('the path summary opens the file through the host', () => {
    const openFile = vi.fn()
    const view = render(<ReadRow {...{ ...rowProps(settled()), openFile }} />)
    fireEvent.click(view.getByRole('button', { name: 'src/a.ts' }))
    // The row derives the file path from args; the chat view resolves it against
    // the cwd before this callback opens it, so the arg path is what arrives.
    expect(openFile).toHaveBeenCalledWith('src/a.ts')
  })

  it('a running read renders the summary row alone, and its state', () => {
    const view = render(<ReadRow {...rowProps(running())} />)
    expect(view.container.querySelector('[data-variant="read"]')?.getAttribute('data-state')).toBe('running')
    expect(view.container.querySelector('[data-read]')).toBeNull()
  })

  it('an error read result shows the error state and no read card', () => {
    const view = render(<ReadRow {...rowProps(settled({
      resultView: { card: 'generic' }, isError: true,
      content: [{ type: 'text', text: 'ENOENT' }],
    }))} />)
    expect(view.container.querySelector('[data-variant="read"]')?.getAttribute('data-state')).toBe('error')
    expect(view.container.querySelector('[data-read]')).toBeNull()
  })

  it('an interrupted read shows the stopped state', () => {
    const view = render(<ReadRow {...rowProps(settled({
      resultView: null, isError: true, error: { name: 'ToolError', code: 'interrupted' },
    }))} />)
    expect(view.container.querySelector('[data-variant="read"]')?.getAttribute('data-state')).toBe('stopped')
  })

  it('registers under the read key of the keyed toolview slot', () => {
    const registered: { name: unknown; key?: unknown }[] = []
    const ctx = { slots: {
      inject: (_name: string, callback: () => () => void) => callback(),
      register: (options: { name: unknown; key?: unknown }) => { registered.push(options); return () => undefined },
    } } as unknown as Context
    readToolview.apply(ctx)
    // The row composes ToolRow, so it declares its locale namespace at the seat.
    expect(registered).toEqual([{ name: 'tool.call.toolview', key: 'read', locale: 'conversation' }])
    expect(readToolview.inject).toEqual(['slots'])
  })
})

describe('DetailsPanel Output section (read)', () => {
  function mount(snapshot: ConversationSnapshot, selection: SelectionTarget | null, cwd?: string) {
    localStorage.clear()
    const chat = createChatStore().create()
    if (selection !== null) chat.actions.select(selection)
    const sessions = createSnapshotStore<SessionListState>(cwd === undefined
      ? { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }
      : {
        ids: [SID],
        byId: { [SID]: { id: SID, displayTitle: 'r', running: false, blank: false, updatedAt: 0, cwd } },
        current: SID,
        phase: 'ready',
        subagentsByParent: {}, jobsBySession: {},
        currentAddress: undefined,
      })
    const workspaces = createSnapshotStore<WorkspaceListState>({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: undefined,
    })
    return render(
      <DetailsPanel
        SessionProvider={SessionProviderStub}
        renderSlot={renderToolDetails(t)}
        sessionId={SID}
        t={t}
        useSession={bindSnapshotSelector({ getSnapshot: () => snapshot, subscribe: () => () => {} })}
        useSessions={bindSnapshotSelector(sessions)}
        useWorkspaces={bindSnapshotSelector(workspaces)}
        useInput={(() => { throw new Error('unused') })}
        inputActions={{
          setDraft: () => {},
          addImages: () => true,
          removeImage: () => {},
          pruneImages: () => {},
          submit: () => {},
        }}
        useProjection={(() => undefined)}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
      />,
    )
  }

  function snapshot(over: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
    const nodes = over.nodes ?? []
    const runningCalls = over.runningCalls ?? []
    return {
      sessionId: SID, views: EMPTY_CONVERSATION_VIEWS,
      chat: over.chat ?? toolChatSnapshot(nodes, runningCalls),
      nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
      pending: [], queue: [], running: false, composerPhase: 'active', removed: false,
      openState: 'open', openError: null, hasMore: false, loadingOlder: false,
      promptError: null, blank: false, subagent: null, lastAgentError: null, ...over,
    }
  }

  const target: SelectionTarget = { turnSeq: 10, callId: 'c1', toolName: 'read' }

  it('renders the read card at full height, keeping the JSON Input section', () => {
    const long = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, text: `row-${i}` }))
    const view = mount(snapshot({
      nodes: [settled({ resultView: resultRead({ lines: long, totalLines: 20 }) })],
    }), target)
    expect(view.getByText(/"file_path"/)).toBeTruthy()
    expect(view.container.querySelector('[data-read]')).not.toBeNull()
    // The panel takes the primitive's own default cap (16), not the row's.
    expect(view.getByText(`… 其余 ${20 - 16} 行`)).toBeTruthy()
    expect(contentTexts(view.container)).toContain('row-0')
  })

  it('a non-read result keeps the flattened pre form', () => {
    const view = mount(snapshot({
      nodes: [settled({
        callView: null, resultView: null,
        content: [{ type: 'text', text: 'plain result' }],
      })],
    }), target)
    expect(view.container.querySelector('[data-read]')).toBeNull()
    expect(view.getByText('输出').closest('section')?.querySelector('pre')?.textContent).toBe('plain result')
  })

  it('a running read keeps the 运行中… placeholder (no result view)', () => {
    const view = mount(snapshot({ runningCalls: [running()] }), target)
    expect(view.getByText('运行中…')).toBeTruthy()
    expect(view.container.querySelector('[data-read]')).toBeNull()
  })
})
