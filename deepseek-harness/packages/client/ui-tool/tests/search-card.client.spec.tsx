// @vitest-environment jsdom
// The search render intent on the web side: the pure searchCardModel derivation
// over resultView, and the conversation render sites that consume it — the chat
// tool row (GenericToolCard's fallback body and SearchRow, both composing the
// shared ToolRow with the search card collapsed by default) and the details
// panel's Output section (resident, full height). The keyed registration under
// both grep and glob is pinned here too.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import {
  createSnapshotStore, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, RunningToolCall, SessionId, SessionListState, ToolResultNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SelectionTarget } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { CHAT_SEARCH_MAX_LINES, searchCardModel } from '../src/client/tool/models/search-card-model.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { createChatStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import { GenericToolCard, type GenericToolCardProps } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { DetailsPanel } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/DetailsPanel.tsx'
import { SearchRow, searchToolview } from '../src/client/tool/toolviews/search-row.tsx'
import { renderToolDetails, SessionProviderStub, toolChatSnapshot } from './tool-details-render.client.tsx'

/** SearchRow now composes ToolRow, so its props include the locale `t` seat. */
type SearchRowProps = Parameters<typeof SearchRow>[0]

afterEach(cleanup)

/** Conversation-locale translate stub for the render sites' `t` seat. */
const t: GenericToolCardProps['t'] = makeTranslate(zh, commonZh)

/** The rendered search card's kind attribute, so a render site cannot silently drop it. */
function searchKindOf(container: HTMLElement): string | null {
  return container.querySelector('[data-search]')?.getAttribute('data-search') ?? null
}

/** The rendered result rows of the search card, one string per visible row. */
function searchRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-search] [class^="_line_"]')].map(row => row.textContent ?? '')
}

const SID = 's1' as SessionId

const GREP_ARGS = '{"pattern":"foo","path":"src"}'
const GLOB_ARGS = '{"pattern":"**/*.ts","path":"src"}'

/** A grep result view: matches grouped by file. */
const resultMatches = (over?: Partial<Extract<ToolResultView, { card: 'search'; shape: 'matches' }>>): ToolResultView => ({
  card: 'search', shape: 'matches',
  files: [
    { path: 'a.ts', matches: [{ lineNumber: 12, line: 'const foo = 1' }, { lineNumber: 40, line: 'return foo' }] },
    { path: 'b.ts', matches: [{ lineNumber: 7, line: 'foo()' }] },
  ],
  truncated: false, total: 3, ...over,
})

/** A glob result view: a flat path list. */
const resultPaths = (over?: Partial<Extract<ToolResultView, { card: 'search'; shape: 'paths' }>>): ToolResultView => ({
  card: 'search', shape: 'paths', paths: ['src/a.ts', 'src/b.ts'], truncated: false, total: 2, ...over,
})

const runningGrep = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'grep', argsRaw: GREP_ARGS,
  turn: 1, step: 1, time: 1_000, callView: { card: 'generic', title: 'Grep foo', kind: 'search' }, subCalls: [], ...over,
})

const settledGrep = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'grep', argsRaw: GREP_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'a.ts\n  Line 12: const foo = 1' }], isError: false,
  callView: { card: 'generic', title: 'Grep foo', kind: 'search' }, resultView: resultMatches(), subCalls: [], ...over,
})

const settledGlob = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 11, time: 2_000, callId: 'c2',
  call: { name: 'glob', argsRaw: GLOB_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'src/a.ts\nsrc/b.ts' }], isError: false,
  callView: { card: 'generic', title: 'Glob **/*.ts', kind: 'search' }, resultView: resultPaths(), subCalls: [], ...over,
})

describe('searchCardModel', () => {
  it('derives a matches card from the grep result view', () => {
    expect(searchCardModel(settledGrep())).toEqual({
      title: undefined,
      recovery: undefined,
      card: {
        kind: 'matches',
        files: [
          { path: 'a.ts', matches: [{ lineNumber: 12, line: 'const foo = 1' }, { lineNumber: 40, line: 'return foo' }] },
          { path: 'b.ts', matches: [{ lineNumber: 7, line: 'foo()' }] },
        ],
        truncated: false, total: 3,
      },
    })
  })

  it('derives a paths card from the glob result view, carrying the truncation signal', () => {
    // Empty block content isolates the truncation signal from the recovery arm.
    expect(searchCardModel(settledGlob({ content: [], resultView: resultPaths({ truncated: true, total: 20 }) }))).toEqual({
      title: undefined,
      recovery: undefined,
      card: { kind: 'paths', paths: ['src/a.ts', 'src/b.ts'], truncated: true, total: 20 },
    })
  })

  it('carries the result view\'s replacement title when the presenter sets one', () => {
    expect(searchCardModel(settledGrep({ resultView: resultMatches({ title: '3 matches' }) }))?.title).toBe('3 matches')
    // Without one it is absent, so the row keeps its args-derived summary.
    expect(searchCardModel(settledGrep())?.title).toBeUndefined()
  })

  it('returns null for every non-search call: running, no views, generic, terminal, unknown cards', () => {
    // A search card is result-time only: a running call has no result view yet.
    expect(searchCardModel(runningGrep())).toBeNull()
    expect(searchCardModel(settledGrep({ callView: null, resultView: null }))).toBeNull()
    // A generic result settles a search call as a generic card (grep/glob failure
    // or a nested run_code dispatch), which keeps the generic path.
    expect(searchCardModel(settledGrep({ resultView: { card: 'generic' } }))).toBeNull()
    // A terminal result view is a different card entirely.
    expect(searchCardModel(settledGrep({ resultView: { card: 'terminal', output: 'x' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire; the
    // documented generic-card default takes it, not a crash.
    const future = { card: 'chart' } as unknown as ToolResultView
    expect(searchCardModel(settledGrep({ resultView: future }))).toBeNull()
  })

  it('returns null for a card:search view whose shape this version does not compile', () => {
    // `shape` rides the same untrusted wire frame as `card`; a subtype this client
    // does not know must fall to the generic path, never render as a paths card
    // that would crash SearchBlock on an absent `paths`.
    const futureShape = {
      card: 'search', shape: 'future', truncated: false, total: 0,
    } as unknown as ToolResultView
    expect(searchCardModel(settledGrep({ resultView: futureShape }))).toBeNull()
  })

  it('returns null for a known shape whose structured shape is missing or malformed', () => {
    // The host wire schema checks the `card`/`shape` strings but not the grouped
    // shape, so a version mismatch could deliver shape:'matches' with no `files`
    // (or shape:'paths' with no `paths`). Rendering that crashes SearchBlock at
    // `.reduce`/`.map`; the derivation drops to the generic path instead.
    const noFiles = { card: 'search', shape: 'matches', truncated: false, total: 0 } as unknown as ToolResultView
    expect(searchCardModel(settledGrep({ resultView: noFiles }))).toBeNull()
    const badFile = {
      card: 'search', shape: 'matches', truncated: false, total: 1,
      files: [{ path: 'a.ts', matches: [{ lineNumber: 'x', line: 1 }] }],
    } as unknown as ToolResultView
    expect(searchCardModel(settledGrep({ resultView: badFile }))).toBeNull()
    const noPaths = { card: 'search', shape: 'paths', truncated: false, total: 0 } as unknown as ToolResultView
    expect(searchCardModel(settledGlob({ resultView: noPaths }))).toBeNull()
    const badPaths = {
      card: 'search', shape: 'paths', truncated: false, total: 1, paths: [42],
    } as unknown as ToolResultView
    expect(searchCardModel(settledGlob({ resultView: badPaths }))).toBeNull()
  })

  it('surfaces the recovery text only when the result was capped', () => {
    const recovery = 'a.ts\n  12: const foo = 1\n\n(Full grep result stored at: spill://grep-1. Read it to see every match.)'
    // The recovery locator lives in the raw tool/result content (the view carries
    // no text), surfaced only when the card capped the result.
    const capped = searchCardModel(settledGrep({
      content: [{ type: 'text', text: recovery }],
      resultView: resultMatches({ truncated: true, total: 42 }),
    }))
    expect(capped?.recovery).toBe(recovery)
    // Not capped: the card holds every match, so the raw content adds nothing and
    // is dropped.
    const whole = searchCardModel(settledGrep({
      content: [{ type: 'text', text: recovery }],
      resultView: resultMatches({ truncated: false }),
    }))
    expect(whole?.recovery).toBeUndefined()
    // Capped but the block carries no text: nothing to surface.
    const noText = searchCardModel(settledGrep({ content: [], resultView: resultMatches({ truncated: true, total: 42 }) }))
    expect(noText?.recovery).toBeUndefined()
  })
})

describe('chat row search body (GenericToolCard fallback)', () => {
  const ownerProps = (block: RunningToolCall | ToolResultNode, toolName: string): GenericToolCardProps => ({
    callId: 'c1', toolName, block, openFile: vi.fn(), t,
  })
  /** The whole summary row is the expand toggle (ToolRow's unified interaction). */
  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('the expanded body is the grouped matches, capped tighter than the panel', () => {
    expect(CHAT_SEARCH_MAX_LINES).toBeLessThan(16)
    const view = render(<GenericToolCard {...ownerProps(settledGrep(), 'grep')} />)
    // Collapsed: the one-line summary row only, no card.
    expect(view.queryByText(/const foo = 1/)).toBeNull()
    toggleRow(view)
    expect(searchRows(view.container)).toContain('12: const foo = 1')
    expect(view.getByText('a.ts')).toBeTruthy()
    expect(searchKindOf(view.container)).toBe('matches')
    // The args JSON body the generic path would have shown is gone.
    expect(view.queryByText(/"pattern"/)).toBeNull()
  })

  it('the glob fallback expands to the flat path card', () => {
    const view = render(<GenericToolCard {...ownerProps(settledGlob(), 'glob')} />)
    toggleRow(view)
    expect(view.getByText('src/a.ts')).toBeTruthy()
    expect(searchKindOf(view.container)).toBe('paths')
  })

  it('a non-search result keeps the args-JSON text body', () => {
    const view = render(<GenericToolCard {...ownerProps(settledGrep({
      resultView: { card: 'generic' },
    }), 'grep')} />)
    toggleRow(view)
    expect(view.getByText(/"pattern"/)).toBeTruthy()
    expect(searchKindOf(view.container)).toBeNull()
  })

  it('the expanded body shows the recovery footer below a capped card', () => {
    const recovery = 'a.ts\n  12: const foo = 1\n\n(Full grep result stored at: spill://grep-1. Read it to see every match.)'
    const view = render(<GenericToolCard {...ownerProps(settledGrep({
      content: [{ type: 'text', text: recovery }],
      resultView: resultMatches({ truncated: true, total: 42 }),
    }), 'grep')} />)
    toggleRow(view)
    expect(searchKindOf(view.container)).toBe('matches')
    expect(view.getByText(/Full grep result stored at: spill:\/\/grep-1/)).toBeTruthy()
  })
})

describe('SearchRow keyed card', () => {
  const rowProps = (block: RunningToolCall | ToolResultNode, toolName: string): SearchRowProps => ({
    callId: 'c1', toolName, block, openFile: vi.fn(), sessionId: SID, t,
  } as unknown as SearchRowProps)

  /** The whole summary row is the expand toggle (ToolRow's unified interaction). */
  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('collapses to the summary row; expanding reveals the grep card', () => {
    const view = render(<SearchRow {...rowProps(settledGrep(), 'grep')} />)
    expect(view.getByText('Grep')).toBeTruthy()
    expect(view.queryByText('Search')).toBeNull()
    // Collapsed: the card is not in the DOM until the row is expanded.
    expect(searchKindOf(view.container)).toBeNull()
    expect(view.queryByText(/const foo = 1/)).toBeNull()
    toggleRow(view)
    expect(searchRows(view.container)).toContain('12: const foo = 1')
    expect(searchKindOf(view.container)).toBe('matches')
    // The card's copy control lives inside the expanded body.
    expect(view.getByText('复制')).toBeTruthy()
  })

  it('expands to the glob path card', () => {
    const view = render(<SearchRow {...rowProps(settledGlob(), 'glob')} />)
    expect(view.getByText('Glob')).toBeTruthy()
    expect(view.queryByText('Search')).toBeNull()
    expect(searchKindOf(view.container)).toBeNull()
    toggleRow(view)
    expect(view.getByText('src/a.ts')).toBeTruthy()
    expect(searchKindOf(view.container)).toBe('paths')
  })

  it('agrees with the summary row about the run state', () => {
    const runningView = render(<SearchRow {...rowProps(runningGrep(), 'grep')} />)
    expect(runningView.container.querySelector('[data-variant="search"]')?.getAttribute('data-state')).toBe('running')
    // No result view yet, so no card even once material could expand.
    expect(searchKindOf(runningView.container)).toBeNull()
    cleanup()
    const errorView = render(<SearchRow {...rowProps(settledGrep({
      isError: true, resultView: { card: 'generic' },
    }), 'grep')} />)
    expect(errorView.container.querySelector('[data-variant="search"]')?.getAttribute('data-state')).toBe('error')
  })

  it('surfaces the result text through the Output section when an errored search has no card', () => {
    // grep/glob return no presentResult on error → no card; the row shows the
    // first error line as the collapsed summary and the full text once expanded.
    const view = render(<SearchRow {...rowProps(settledGrep({
      isError: true, resultView: null,
      content: [{ type: 'text', text: 'grep: invalid regular expression' }],
    }), 'grep')} />)
    expect(searchKindOf(view.container)).toBeNull()
    // Error state: the first line is the collapsed summary.
    expect(view.getByText('grep: invalid regular expression')).toBeTruthy()
    toggleRow(view)
    // Now in ToolRow's Output section too (the kept summary makes it appear twice).
    expect(view.container.querySelector('[data-error]')?.textContent).toBe('grep: invalid regular expression')
  })

  it('surfaces the result text for a settled non-error call with no card once expanded', () => {
    // A successful nested run_code sub-dispatch (backend computes no
    // presentationMeta, so resultView is null) or a legacy generic result settles
    // with search === null and state ok. The keyed SearchRow owns the slot, so
    // ToolRow's Output section carries the text; it is only visible expanded.
    const view = render(<SearchRow {...rowProps(settledGrep({
      isError: false, resultView: null,
      content: [{ type: 'text', text: 'nested run_code output line' }],
    }), 'grep')} />)
    expect(view.container.querySelector('[data-variant="search"]')?.getAttribute('data-state')).toBe('ok')
    expect(searchKindOf(view.container)).toBeNull()
    // Collapsed: the ok row shows its args summary, not the output text.
    expect(view.queryByText('nested run_code output line')).toBeNull()
    toggleRow(view)
    expect(view.getByText('nested run_code output line')).toBeTruthy()
  })

  it('renders the recovery footer below the card when the search was capped', () => {
    const recovery = 'a.ts\n  12: const foo = 1\n\n(Full grep result stored at: spill://grep-1. Read it to see every match.)'
    const view = render(<SearchRow {...rowProps(settledGrep({
      content: [{ type: 'text', text: recovery }],
      resultView: resultMatches({ truncated: true, total: 42 }),
    }), 'grep')} />)
    toggleRow(view)
    expect(searchKindOf(view.container)).toBe('matches')
    expect(view.getByText(/Full grep result stored at: spill:\/\/grep-1/)).toBeTruthy()
  })

  it('shows no recovery footer for an uncapped search', () => {
    const view = render(<SearchRow {...rowProps(settledGrep(), 'grep')} />)
    toggleRow(view)
    expect(searchKindOf(view.container)).toBe('matches')
    expect(view.container.textContent).not.toMatch(/stored at/)
  })

  it('falls back to the error name/code when an errored result has no text block', () => {
    const view = render(<SearchRow {...rowProps(settledGrep({
      isError: true, resultView: null, content: [],
      error: { name: 'ToolError', code: 'timeout' },
    }), 'grep')} />)
    // Error state: the derived name/code line is the collapsed summary.
    expect(view.getByText('ToolError: timeout')).toBeTruthy()
  })

  it('shows the result view\'s replacement title instead of the args summary', () => {
    const view = render(<SearchRow {...rowProps(settledGrep({
      resultView: resultMatches({ title: '3 matches in 2 files' }),
    }), 'grep')} />)
    expect(view.getByText('3 matches in 2 files')).toBeTruthy()
  })

  it('keeps the args-derived summary when the result view has no title', () => {
    const view = render(<SearchRow {...rowProps(settledGrep(), 'grep')} />)
    expect(view.getByText('foo')).toBeTruthy()
  })

  it('registers the one row component under both grep and glob keys', () => {
    const registered: { key: unknown; locale: unknown; component: unknown }[] = []
    const ctx = {
      slots: {
        inject: (_name: string, callback: () => Iterable<() => void>) => {
          for (const _dispose of callback()) { /* exhaust transactional setup */ }
          return () => undefined
        },
        register: (options: { name: string; key: string; locale?: string }, component: unknown) => {
          registered.push({ key: options.key, locale: options.locale, component })
          return () => undefined
        },
      },
    } as never
    searchToolview.apply(ctx)
    expect(registered.map(r => r.key)).toEqual(['grep', 'glob'])
    // Both keys claim the conversation locale seat ToolRow's body copy needs.
    expect(registered.map(r => r.locale)).toEqual(['conversation', 'conversation'])
    // One component, two keys.
    expect(registered[0]!.component).toBe(SearchRow)
    expect(registered[1]!.component).toBe(SearchRow)
    expect(searchToolview.inject).toEqual(['slots'])
  })
})

describe('DetailsPanel Output section (search)', () => {
  function mount(snapshot: ConversationSnapshot, selection: SelectionTarget | null) {
    localStorage.clear()
    const chat = createChatStore().create()
    if (selection !== null) chat.actions.select(selection)
    const sessions = createSnapshotStore<SessionListState>({
      ids: [], byId: {}, current: undefined, phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
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

  const grepTarget: SelectionTarget = { turnSeq: 10, callId: 'c1', toolName: 'grep' }
  const globTarget: SelectionTarget = { turnSeq: 11, callId: 'c2', toolName: 'glob' }

  it('renders the grep matches card at full height, keeping the JSON Input section', () => {
    const view = mount(snapshot({ nodes: [settledGrep()] }), grepTarget)
    expect(view.getByText(/"pattern"/)).toBeTruthy()
    expect(searchRows(view.container)).toContain('12: const foo = 1')
    expect(searchKindOf(view.container)).toBe('matches')
  })

  it('renders the glob path card', () => {
    const view = mount(snapshot({ nodes: [settledGlob()] }), globTarget)
    expect(view.getByText('src/a.ts')).toBeTruthy()
    expect(searchKindOf(view.container)).toBe('paths')
  })

  it('renders the recovery footer below the card for a capped search', () => {
    const recovery = 'src/a.ts\nsrc/b.ts\n\n(Showing 2 of 23 paths. Full sorted result stored at: spill://glob-7.)'
    const view = mount(snapshot({
      nodes: [settledGlob({ content: [{ type: 'text', text: recovery }], resultView: resultPaths({ truncated: true, total: 23 }) })],
    }), globTarget)
    expect(searchKindOf(view.container)).toBe('paths')
    expect(view.getByText(/Full sorted result stored at: spill:\/\/glob-7/)).toBeTruthy()
  })

  it('a non-search result keeps the flattened pre form', () => {
    const view = mount(snapshot({
      nodes: [settledGrep({ callView: null, resultView: null })],
    }), grepTarget)
    expect(searchKindOf(view.container)).toBeNull()
    const output = view.getByText('输出').closest('section')
    expect(output?.querySelector('pre')?.textContent).toContain('const foo = 1')
  })
})
