// @vitest-environment jsdom
// The terminal render intent on the web side: the pure terminalCardModel
// derivation over callView/resultView, and both conversation render sites that
// consume it — the chat tool row's expanded body (GenericToolCard / BashRow)
// and the details panel's Output section.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import {
  createSnapshotStore, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, RunningToolCall, SessionId, SessionListState, ToolResultNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SelectionTarget } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { terminalCardModel, terminalFailed } from '../src/client/tool/models/terminal-card-model.ts'
import { createChatStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import { GenericToolCard, type GenericToolCardProps } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { DetailsPanel } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/DetailsPanel.tsx'
import { BashRow } from '../src/client/tool/toolviews/bash-sample.tsx'
import { renderToolDetails, SessionProviderStub, toolChatSnapshot } from './tool-details-render.client.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

type BashRowProps = Parameters<typeof BashRow>[0]

// Mirrors the real lookup chain (conversation namespace, then common).
const t: GenericToolCardProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

/**
 * Match an output line with its interior whitespace intact: the column
 * alignment this card exists to preserve is exactly what the default
 * whitespace-collapsing matcher would hide.
 */
const RAW = { normalizer: (text: string) => text }

/** The rendered card's run-state dot state, so a render site cannot silently drop it. */
function runStateOf(container: HTMLElement): string | null {
  return container.querySelector('[data-terminal] [data-state]')?.getAttribute('data-state') ?? null
}

const SID = 's1' as SessionId

const ARGS = '{"command":"ls -la","description":"List files"}'

/** The bash tool's own call view for a foreground command. */
const callTerminal = (over?: Partial<Extract<ToolCallView, { card: 'terminal' }>>): ToolCallView => ({
  card: 'terminal', title: 'ls -la', description: 'List files', ...over,
})

/** The bash tool's own result view for a settled foreground command. */
const resultTerminal = (over?: Partial<Extract<ToolResultView, { card: 'terminal' }>>): ToolResultView => ({
  card: 'terminal', output: 'a.ts  b.ts\nc.ts  d.ts\n', exitCode: 0, ...over,
})

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'bash', argsRaw: ARGS,
  turn: 1, step: 1, time: 1_000, callView: callTerminal(), subCalls: [], ...over,
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'bash', argsRaw: ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'a.ts  b.ts\nc.ts  d.ts\n' }], isError: false,
  callView: callTerminal(), resultView: resultTerminal(), subCalls: [], ...over,
})

describe('terminalCardModel', () => {
  it('derives a running card from the call view alone', () => {
    expect(terminalCardModel(running({ callView: callTerminal({ cwd: '/projects/app' }) }))).toEqual({
      description: 'List files',
      card: {
        command: 'ls -la', cwd: '/projects/app', output: undefined,
        exitCode: undefined, signal: undefined, running: true,
      },
    })
  })

  it('derives a settled card from both sides, carrying the exit status', () => {
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '/projects/app' }),
      resultView: resultTerminal({ output: 'boom\n', exitCode: 2 }),
    }))).toEqual({
      description: 'List files',
      card: {
        command: 'ls -la', cwd: '/projects/app', output: 'boom\n',
        exitCode: 2, signal: undefined, running: false,
      },
    })
    expect(terminalCardModel(settled({
      resultView: { card: 'terminal', output: '', signal: 'SIGTERM' },
    }))?.card.signal).toBe('SIGTERM')
  })

  it('flags a failing exit as terminalFailed; clean exits and running cards are not', () => {
    // isError stays false on a failing command (the exit status is result
    // data), so this predicate is the row's only failure signal.
    expect(terminalFailed(terminalCardModel(settled({
      resultView: resultTerminal({ exitCode: 2 }),
    }))!)).toBe(true)
    expect(terminalFailed(terminalCardModel(settled({
      resultView: { card: 'terminal', output: '', signal: 'SIGTERM' },
    }))!)).toBe(true)
    expect(terminalFailed(terminalCardModel(settled())!)).toBe(false)
    expect(terminalFailed(terminalCardModel(running())!)).toBe(false)
  })

  it('takes the result view\'s replacement title over the pending one', () => {
    // The presentation contract defines a result title as REPLACING the pending
    // title, so a tool that rewrites it at settle time must win here.
    expect(terminalCardModel(settled({
      callView: callTerminal({ title: 'pnpm run check' }),
      resultView: resultTerminal({ title: 'pnpm run check --filter web' }),
    }))?.card.command).toBe('pnpm run check --filter web')
    // Without one, the call's title is what the card keeps.
    expect(terminalCardModel(settled())?.card.command).toBe('ls -la')
  })

  it('resolves the cwd against the session workspace the way the bridge must', () => {
    // Omitted workdir — the common bash call — IS the session workspace.
    expect(terminalCardModel(settled(), '/w/app')?.card.cwd).toBe('/w/app')
    // A relative workdir joins under it.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: 'packages/ui' }),
    }), '/w/app')?.card.cwd).toBe('/w/app/packages/ui')
    // An absolute one is used as-is.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '/srv/other' }),
    }), '/w/app')?.card.cwd).toBe('/srv/other')
    // With no session cwd there is nothing to resolve against: a relative path
    // stays as authored and an omitted one stays absent (a bare `$` prompt).
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: 'packages/ui' }),
    }))?.card.cwd).toBe('packages/ui')
    expect(terminalCardModel(settled())?.card.cwd).toBeUndefined()
    // The running arm resolves identically.
    expect(terminalCardModel(running(), '/w/app')?.card.cwd).toBe('/w/app')
  })

  it('normalizes a relative workdir so the label names the directory actually used', () => {
    // The bash executor resolves the workdir before running, so `..` against
    // /w/app runs in /w — the card must say `w`, not `..`.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '..' }),
    }), '/w/app')?.card.cwd).toBe('/w')
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '.' }),
    }), '/w/app')?.card.cwd).toBe('/w/app')
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '../sibling' }),
    }), '/w/app')?.card.cwd).toBe('/w/sibling')
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: './nested/../other' }),
    }), '/w/app')?.card.cwd).toBe('/w/app/other')
    // A `..` that would climb past the root is dropped, as a filesystem does.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '../../..' }),
    }), '/w')?.card.cwd).toBe('/')
    // An absolute path carrying segments normalizes too.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '/srv/./app/../other' }),
    }), '/w/app')?.card.cwd).toBe('/srv/other')
    // A Windows path keeps its separators.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: 'C:\\ws\\app\\..' }),
    }), '/w')?.card.cwd).toBe('C:\\ws')
    // Without a session cwd a relative `..` has nothing to resolve against, so
    // it survives as authored rather than being silently dropped.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '../elsewhere' }),
    }))?.card.cwd).toBe('../elsewhere')
  })

  it('keeps a UNC server and share as an unpoppable root', () => {
    // Windows cannot climb above a share, so `..` from the share root stays put.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '..' }),
    }), '\\\\server\\share')?.card.cwd).toBe('\\\\server\\share')
    // Below the share it pops normally, keeping the UNC separators.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '..' }),
    }), '\\\\server\\share\\app')?.card.cwd).toBe('\\\\server\\share')
    // Several `..` cannot escape the root either.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '../../..' }),
    }), '\\\\server\\share\\app')?.card.cwd).toBe('\\\\server\\share')
  })

  it('draws a bare $ when the window dropped the call head, rather than guessing', () => {
    // A truncated call carries no cwd anywhere: the result view has none, and
    // the original call may have used an explicit workdir. Falling back to the
    // session workspace here would name a directory the card cannot know.
    expect(terminalCardModel(settled({
      call: null, callView: null, resultView: resultTerminal({ title: 'ls -la' }),
    }), '/w/app')?.card.cwd).toBeUndefined()
    // A present call view that omits its cwd still means the workspace.
    expect(terminalCardModel(settled(), '/w/app')?.card.cwd).toBe('/w/app')
  })

  it('carries the call view\'s description, which the contract renders above the card', () => {
    expect(terminalCardModel(settled())?.description).toBe('List files')
    expect(terminalCardModel(running())?.description).toBe('List files')
    // A presenter that supplies none, and a window-truncated call side, both
    // leave it absent so the row keeps its args-derived summary.
    expect(terminalCardModel(settled({
      callView: { card: 'terminal', title: 'ls' },
    }))?.description).toBeUndefined()
    expect(terminalCardModel(settled({ call: null, callView: null }))?.description).toBeUndefined()
  })

  it('a window-truncated call side falls back to the result title, then to an empty command', () => {
    // Truncation drops both the call head and its view (conversation.ts).
    const truncated = { call: null, callView: null }
    expect(terminalCardModel(settled({
      ...truncated, resultView: resultTerminal({ title: 'ls -la' }),
    }))?.card).toMatchObject({ command: 'ls -la', cwd: undefined, running: false })
    expect(terminalCardModel(settled(truncated))?.card).toMatchObject({ command: '', cwd: undefined })
  })

  it('returns null for every non-terminal call: no views, generic views, unknown cards', () => {
    expect(terminalCardModel(running({ callView: null }))).toBeNull()
    expect(terminalCardModel(settled({ callView: null, resultView: null }))).toBeNull()
    expect(terminalCardModel(running({ callView: { card: 'generic', title: 'read x' } }))).toBeNull()
    // A generic result settles a terminal call as a generic card (the bash
    // tool's own execution-error and background paths).
    expect(terminalCardModel(settled({ resultView: { card: 'generic' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire; the
    // documented generic-card default takes it, not a crash.
    const future = { card: 'chart', title: 'plot' } as unknown as ToolCallView
    expect(terminalCardModel(running({ callView: future }))).toBeNull()
    expect(terminalCardModel(settled({
      callView: future, resultView: { card: 'chart' } as unknown as ToolResultView,
    }))).toBeNull()
  })
})

describe('chat row terminal body', () => {
  const ownerProps = (block: RunningToolCall | ToolResultNode): GenericToolCardProps => ({
    callId: 'c1', toolName: 'bash', block, openFile: vi.fn(), t,
  })

  /** The whole summary row is the expand toggle (ToolRow's unified interaction). */
  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('the expanded body is the command output inside the row scroll container', () => {
    const view = render(<GenericToolCard {...ownerProps(settled())} />)
    // Collapsed: the one-line summary row only, no output.
    expect(view.getByText('List files')).toBeTruthy()
    expect(view.queryByText(/a\.ts/)).toBeNull()
    toggleRow(view)
    expect(view.getByText('a.ts  b.ts', RAW)).toBeTruthy()
    expect(view.getByText('ls -la')).toBeTruthy()
    // The args JSON body the generic path would have shown is gone.
    expect(view.queryByText(/"command"/)).toBeNull()
  })

  it('a long output renders in full — the scroll container replaces the middle collapse', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`)
    const view = render(<GenericToolCard {...ownerProps(settled({
      resultView: resultTerminal({ output: `${lines.join('\n')}\n` }),
    }))} />)
    toggleRow(view)
    expect(view.getByText('line-5')).toBeTruthy()
    expect(view.getByText('line-19')).toBeTruthy()
    expect(view.queryByText(/其余/)).toBeNull()
  })

  it('renders a multi-line command as one prompt row per line', () => {
    const view = render(<GenericToolCard {...ownerProps(settled({
      callView: callTerminal({ title: 'ls -la\necho done' }),
    }))} />)
    toggleRow(view)
    const rows = view.container.querySelectorAll('[class^="_promptLine_"]')
    expect([...rows].map(row => row.textContent)).toEqual(['$ls -la', '$echo done'])
    // Still one dot for the call, on the first row.
    expect(view.container.querySelectorAll('[data-terminal] [data-state]')).toHaveLength(1)
  })

  it('the fallback row shows the presenter description, not the args summary', () => {
    // Any terminal-declaring tool without its own keyed row lands here, so the
    // contract's above-card description has to win at this render site as well.
    const view = render(<GenericToolCard {...ownerProps(settled({
      callView: callTerminal({ description: 'Terminal 3' }),
    }))} />)
    expect(view.getByText('Terminal 3')).toBeTruthy()
    expect(view.queryByText('List files')).toBeNull()
  })

  it('keeps the presenter description visible once the terminal card is expanded', () => {
    // The contract puts the description ABOVE the card. The collapsed summary is
    // hidden while a row is open, so an expanded terminal row has to draw it
    // itself or the description would only ever be visible collapsed.
    const view = render(<GenericToolCard {...ownerProps(settled({
      callView: callTerminal({ description: 'Terminal 3' }),
    }))} />)
    expect(view.getByText('Terminal 3')).toBeTruthy()
    toggleRow(view)
    expect(view.container.querySelector('[data-terminal]')).not.toBeNull()
    expect(view.getByText('Terminal 3')).toBeTruthy()
  })

  it('a running terminal call expands to the prompt line with no output yet', () => {
    const view = render(<GenericToolCard {...ownerProps(running())} />)
    toggleRow(view)
    expect(view.getByText('ls -la')).toBeTruthy()
    expect(view.queryByText('复制')).toBeNull()
    // The card states its own run state: a running command reads as running
    // even though it has no output yet to distinguish it from an empty settle.
    expect(runStateOf(view.container)).toBe('ongoing')
  })

  it('a non-terminal call keeps the args-JSON text body', () => {
    const view = render(<GenericToolCard {...ownerProps(settled({
      callView: null, resultView: null,
    }))} />)
    toggleRow(view)
    expect(view.getByText(/"command"/)).toBeTruthy()
  })

  it('a terminal call with no args still expands, through its terminal body alone', () => {
    // Empty args make the text body null; the terminal material carries the row.
    const view = render(<GenericToolCard {...ownerProps(settled({
      call: { name: 'bash', argsRaw: '' },
    }))} />)
    toggleRow(view)
    expect(view.getByText('a.ts  b.ts', RAW)).toBeTruthy()
  })

  it('a failing exit status surfaces as the collapsed row\'s error state', () => {
    const view = render(<GenericToolCard {...ownerProps(settled({
      resultView: resultTerminal({ exitCode: 2 }),
    }))} />)
    expect(view.container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('error')
  })
})

describe('BashRow terminal card', () => {
  const list = () => createSnapshotStore<SessionListState>({
    ids: [SID],
    byId: { [SID]: { id: SID, displayTitle: 'r', running: false, blank: false, updatedAt: 0 } },
    current: undefined,
    phase: 'ready',
    subagentsByParent: {}, jobsBySession: {},
    currentAddress: undefined,
  })

  const rowProps = (block: RunningToolCall | ToolResultNode): BashRowProps => ({
    callId: 'c1', toolName: 'bash', block, openFile: vi.fn(),
    sessionId: SID, useSessions: bindSnapshotSelector(list()),
    t,
  } as unknown as BashRowProps)

  it('collapses to the summary row; the whole row toggles the command output', () => {
    const view = render(<BashRow {...rowProps(settled())} />)
    expect(view.getByText('List files')).toBeTruthy()
    expect(view.queryByText(/a\.ts/)).toBeNull()
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    expect(view.getByText('a.ts  b.ts', RAW)).toBeTruthy()
    expect(view.getByText('复制')).toBeTruthy()
    // Collapse back in place: the summary row returns, the card unmounts.
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    expect(view.queryByText(/a\.ts/)).toBeNull()
    expect(view.getByText('List files')).toBeTruthy()
  })

  // The row's leading StateDot and the card's run-state dot describe the same
  // command, so a running row whose card claimed 'done' would be a contradiction
  // the reader sees on one line.
  it('agrees with the summary row about the run state', () => {
    const runningView = render(<BashRow {...rowProps(running())} />)
    expect(runningView.container.querySelector('[data-variant="bash"]')?.getAttribute('data-state')).toBe('running')
    fireEvent.click(runningView.container.querySelector('[data-expandable]')!)
    expect(runStateOf(runningView.container)).toBe('ongoing')
    cleanup()
    const settledView = render(<BashRow {...rowProps(settled())} />)
    expect(settledView.container.querySelector('[data-variant="bash"]')?.getAttribute('data-state')).toBe('ok')
    fireEvent.click(settledView.container.querySelector('[data-expandable]')!)
    expect(runStateOf(settledView.container)).toBe('done')
  })

  it('a failing exit status surfaces as the collapsed row\'s error state', () => {
    const view = render(<BashRow {...rowProps(settled({
      resultView: resultTerminal({ exitCode: 2 }),
    }))} />)
    expect(view.container.querySelector('[data-variant="bash"]')?.getAttribute('data-state')).toBe('error')
  })

  it('shows the terminal presenter\'s description instead of the args summary', () => {
    // `terminal_send`-style presenters author a description the args do not
    // repeat; the contract puts it above the card, which is this row's summary.
    const view = render(<BashRow {...rowProps(settled({
      callView: callTerminal({ description: 'Terminal 3' }),
    }))} />)
    expect(view.getByText('Terminal 3')).toBeTruthy()
    expect(view.queryByText('List files')).toBeNull()
  })

  it('keeps the args-derived summary when the presenter authored no description', () => {
    const view = render(<BashRow {...rowProps(settled({
      callView: { card: 'terminal', title: 'ls -la' },
    }))} />)
    expect(view.getByText('List files')).toBeTruthy()
  })

  it('a non-terminal bash call (background start) renders the summary row alone', () => {
    const view = render(<BashRow {...rowProps(settled({
      callView: { card: 'generic', title: 'sleep 30', kind: 'execute' },
      resultView: { card: 'generic' },
    }))} />)
    expect(view.getByText('List files')).toBeTruthy()
    expect(view.queryByText(/a\.ts/)).toBeNull()
    expect(view.container.querySelector('[data-sample="bash"]')?.getAttribute('role')).toBeNull()
  })

  it('expands a generic execution error to its original args and full output', () => {
    const view = render(<BashRow {...rowProps(settled({
      content: [{ type: 'text', text: 'Error: command aborted' }],
      isError: true,
      callView: { card: 'generic', title: 'ls -la', kind: 'execute' },
      resultView: { card: 'generic' },
    }))} />)
    const row = view.container.querySelector('[data-sample="bash"]')!
    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText(/"command": "ls -la"/)).toBeNull()

    fireEvent.click(row)

    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('IN')).toBeTruthy()
    expect(view.getByText('OUT')).toBeTruthy()
    expect(view.getByText(/"command": "ls -la"/)).toBeTruthy()
    expect(view.container.querySelector('[data-error]')?.textContent).toBe('Error: command aborted')
  })
})

describe('DetailsPanel Output section', () => {
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
        useSession={bindSnapshotSelector({ getSnapshot: () => snapshot, subscribe: () => () => {} })}
        useSessions={bindSnapshotSelector(sessions)}
        useWorkspaces={bindSnapshotSelector(workspaces)}
        useInput={(() => { throw new Error('unused') })}
        inputActions={{ setDraft: () => {}, addImages: () => true, removeImage: () => {}, pruneImages: () => {}, submit: () => {} }}
        useProjection={(() => undefined)}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
        t={t}
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

  const target: SelectionTarget = { turnSeq: 10, callId: 'c1', toolName: 'bash' }

  // The panel never unmounts between selections, so per-call view state has to
  // be keyed off the selected call or it leaks into the next one.
  it('resets the card\'s expand state when the selected call changes', () => {
    const long = Array.from({ length: 20 }, (_, i) => `row-${i}`)
    const view = mount(snapshot({
      nodes: [settled({ resultView: resultTerminal({ output: `${long.join('\n')}\n` }) })],
    }), target)
    fireEvent.click(view.getByRole('button', { name: '展开其余 4 行输出' }))
    expect(view.getByRole('button', { name: '收起输出' })).toBeTruthy()
    // A second call, selected without unmounting the panel, starts collapsed.
    cleanup()
    const second = mount(snapshot({
      nodes: [settled({
        callId: 'c2', resultView: resultTerminal({ output: `${long.join('\n')}\n` }),
      })],
    }), { turnSeq: 10, callId: 'c2', toolName: 'bash' })
    expect(second.getByRole('button', { name: '展开其余 4 行输出' })).toBeTruthy()
  })

  it('renders the presenter description above the card', () => {
    const view = mount(snapshot({
      nodes: [settled({ callView: callTerminal({ description: 'Terminal 3' }) })],
    }), target)
    const description = view.getByText('Terminal 3')
    const card = view.container.querySelector('[data-terminal]')
    expect(card).not.toBeNull()
    // Above, not below: document order is what places it as the card's heading.
    expect(description.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('resolves the prompt cwd against the session workspace', () => {
    const view = mount(snapshot({ nodes: [settled()] }), target, '/w/app')
    // No workdir in the call view: the prompt label is the workspace basename.
    expect(view.getByText('app')).toBeTruthy()
  })

  it('renders the terminal card at full height, keeping the JSON Input section', () => {
    const long = Array.from({ length: 20 }, (_, i) => `row-${i}`)
    const view = mount(snapshot({
      nodes: [settled({ resultView: resultTerminal({ output: `${long.join('\n')}\n` }) })],
    }), target)
    expect(view.getByText(/"command"/)).toBeTruthy()
    expect(view.getByText('ls -la')).toBeTruthy()
    // The panel takes the primitive's own default cap (16), not the row's.
    expect(view.getByText(`… 其余 ${20 - 16} 行`)).toBeTruthy()
    expect(view.getByText('row-0')).toBeTruthy()
  })

  it('a running terminal call shows the prompt line, not the 运行中… placeholder', () => {
    const view = mount(snapshot({ runningCalls: [running()] }), target)
    expect(view.getByText('ls -la')).toBeTruthy()
    expect(view.queryByText('运行中…')).toBeNull()
    expect(runStateOf(view.container)).toBe('ongoing')
  })

  it('a running non-terminal call keeps the 运行中… placeholder', () => {
    const view = mount(snapshot({ runningCalls: [running({ callView: null })] }), target)
    expect(view.getByText('运行中…')).toBeTruthy()
  })

  it('a non-terminal result keeps the flattened pre with its error styling', () => {
    const view = mount(snapshot({
      nodes: [settled({
        callView: null, resultView: null, isError: true,
        content: [{ type: 'text', text: 'permission denied' }],
      })],
    }), target)
    const pre = view.container.querySelector('pre[data-error]')
    expect(pre?.textContent).toBe('permission denied')
  })

  // The panel resolves a sub-dispatch through the same material as a native
  // call, so a sub-call that DID carry terminal views would render the card.
  // The shipped wire cannot produce that yet: `session.ts` folds
  // `tool/code-dispatch(-start)` with `callView: null`/`resultView: null`, and
  // the host's `viewFor` only presents top-level `tool/call`/`tool/result`. This
  // pins the resolution path with views injected directly, and the arm below
  // pins what the shipped path actually shows today.
  it('a run_code sub-dispatch resolves to its own terminal card once views reach it', () => {
    const child = settled({ callId: 'c1' })
    const view = mount(snapshot({
      runningCalls: [running({ callId: 'p1', subCalls: [child] })],
    }), target)
    expect(view.getByText('a.ts  b.ts', RAW)).toBeTruthy()
  })

  it('a sub-dispatch as the wire actually delivers it (no views) keeps the flattened form', () => {
    const child = settled({ callId: 'c1', callView: null, resultView: null })
    const view = mount(snapshot({
      runningCalls: [running({ callId: 'p1', subCalls: [child] })],
    }), target)
    // No terminal card: the generic path renders the result text in the Output
    // section's <pre> (the Input section has its own, hence the scoping).
    expect(view.container.querySelector('[data-terminal]')).toBeNull()
    const output = view.getByText('输出').closest('section')
    expect(output?.querySelector('pre')?.textContent).toContain('a.ts  b.ts')
  })

  it('a running run_code sub-dispatch resolves through the running material', () => {
    const view = mount(snapshot({
      // The leading non-matching sub-call exercises the scan's skip.
      runningCalls: [running({
        callId: 'p1',
        subCalls: [running({ callId: 'other' }), running()],
      })],
    }), target)
    expect(view.getByText('ls -la')).toBeTruthy()
  })

  it('a window-truncated call head titles the panel by callId and drops the Input section', () => {
    const view = mount(snapshot({
      nodes: [settled({ call: null, callView: null, resultView: resultTerminal({ title: 'ls -la' }) })],
    }), target)
    expect(view.getByText('c1')).toBeTruthy()
    expect(view.queryByText('输入')).toBeNull()
    expect(view.getByText('输出')).toBeTruthy()
  })

  it('scans past other nodes and other calls before reporting the call out of window', () => {
    const view = mount(snapshot({
      nodes: [
        { kind: 'assistant', seq: 1, time: 1_000, turn: 1, step: 1, blocks: [] },
        settled({ callId: 'elsewhere' }),
      ],
      runningCalls: [running({ callId: 'also-elsewhere' })],
    }), target)
    expect(view.getByText('该调用不在当前窗口内')).toBeTruthy()
  })

  it('no selection at all renders the guidance line and the default title', () => {
    const view = mount(snapshot(), null)
    expect(view.getByText('详情')).toBeTruthy()
    expect(view.getByText('点击消息流中的工具行查看详情')).toBeTruthy()
  })

  it('a step selection without a callId renders the guidance line too', () => {
    const view = mount(snapshot(), { turnSeq: 3, stepSeq: 1 })
    expect(view.getByText('点击消息流中的工具行查看详情')).toBeTruthy()
  })

  it('the close button reaches closeDetails', () => {
    localStorage.clear()
    const chat = createChatStore().create()
    const closeDetails = vi.fn()
    const snap = snapshot()
    const view = render(
      <DetailsPanel
        SessionProvider={SessionProviderStub}
        renderSlot={renderToolDetails(t)}
        sessionId={SID}
        useSession={bindSnapshotSelector({ getSnapshot: () => snap, subscribe: () => () => {} })}
        useSessions={bindSnapshotSelector(createSnapshotStore<SessionListState>(
          {
            ids: [], byId: {}, current: undefined, phase: 'ready',
            subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
          }))}
        useWorkspaces={bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
          items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
          baselinesReady: true, recentWorkspaceId: undefined,
        }))}
        useInput={(() => { throw new Error('unused') })}
        inputActions={{ setDraft: () => {}, addImages: () => true, removeImage: () => {}, pruneImages: () => {}, submit: () => {} }}
        useProjection={(() => undefined)}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={closeDetails}
        t={t}
      />,
    )
    fireEvent.click(view.getByRole('button', { name: '关闭详情' }))
    expect(closeDetails).toHaveBeenCalledTimes(1)
  })

  it('a non-text result block renders as JSON, and an empty result falls back to its error', () => {
    const nonText = mount(snapshot({
      nodes: [settled({
        callView: null, resultView: null,
        content: [{ type: 'reasoning', text: 'why' }],
      })],
    }), target)
    // Scope to the Output section: the Input section's CodeBlock renders a
    // <pre> of its own, and it comes first in document order.
    expect(nonText.getByText('输出').closest('section')?.querySelector('pre')?.textContent)
      .toBe('{\n  "type": "reasoning",\n  "text": "why"\n}')
    cleanup()
    const empty = mount(snapshot({
      nodes: [settled({
        callView: null, resultView: null, content: [], isError: true,
        error: { name: 'ToolError', code: 'interrupted' },
      })],
    }), target)
    expect(empty.getByText('ToolError: interrupted')).toBeTruthy()
  })
})
