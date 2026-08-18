// @vitest-environment jsdom
// The web render intent on the web side: the pure webCardModel derivation over
// resultView, and the conversation render sites that consume it — the keyed
// WebRow (registered under both web_search and web_fetch), the GenericToolCard
// render-site fallback, and the details panel's Output section. Mirrors
// terminal-card.spec.tsx: model derivation + null arms, both kinds, the chat
// row's collapsed-by-default ToolRow card, the panel arm, and the keyed
// registration. WebRow now composes the shared ToolRow, so its web card is
// collapsed by default and appears only once the whole row is expanded.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import {
  createSnapshotStore, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, RunningToolCall, SessionId, SessionListState, ToolResultNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { SelectionTarget } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { webCardModel } from '../src/client/tool/models/web-card-model.ts'
import { createChatStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import { GenericToolCard } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { DetailsPanel } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/DetailsPanel.tsx'
import { WebRow, webToolview } from '../src/client/tool/toolviews/web-row.tsx'
import { renderToolDetails, SessionProviderStub, toolChatSnapshot } from './tool-details-render.client.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

const SID = 's1' as SessionId

/** Locale seat for the card render sites (GenericToolCard, DetailsPanel), as the sibling suites build it. */
const t = makeTranslate(zh, commonZh)

const SEARCH_ARGS = '{"query":"deepseek harness"}'
const FETCH_ARGS = '{"url":"https://example.com/page"}'

/** A web_search result view; overrides tune the sources / answer / truncation. */
const resultSearch = (over?: Partial<Extract<ToolResultView, { card: 'web'; kind: 'search' }>>): ToolResultView => ({
  card: 'web', kind: 'search', truncated: false,
  answer: 'A short answer.',
  sources: [
    { url: 'https://example.com/a', title: 'Titled', snippet: 'excerpt', publishedAt: '2026-07-01' },
    { url: 'https://plain.example.org/b' },
  ],
  ...over,
})

/** A web_fetch result view. */
const resultFetch = (over?: Partial<Extract<ToolResultView, { card: 'web'; kind: 'fetch' }>>): ToolResultView => ({
  card: 'web', kind: 'fetch', url: 'https://example.com/page', statusCode: 200, truncated: false, ...over,
})

const runningSearch = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'web_search', argsRaw: SEARCH_ARGS,
  turn: 1, step: 1, time: 1_000, callView: { card: 'generic', title: 'Search', kind: 'search' }, subCalls: [], ...over,
})

const settledSearch = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'web_search', argsRaw: SEARCH_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'search text' }], isError: false,
  callView: { card: 'generic', title: 'Search', kind: 'search' }, resultView: resultSearch(), subCalls: [], ...over,
})

const settledFetch = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 11, time: 2_000, callId: 'c2',
  call: { name: 'web_fetch', argsRaw: FETCH_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'fetch body' }], isError: false,
  callView: { card: 'generic', title: 'Fetch', kind: 'fetch' }, resultView: resultFetch(), subCalls: [], ...over,
})

describe('webCardModel', () => {
  it('derives a search card from the result view, projecting every source field', () => {
    expect(webCardModel(settledSearch())).toEqual({
      kind: 'search',
      answer: 'A short answer.',
      truncated: false,
      sources: [
        { url: 'https://example.com/a', title: 'Titled', snippet: 'excerpt', publishedAt: '2026-07-01' },
        { url: 'https://plain.example.org/b', title: undefined, snippet: undefined, publishedAt: undefined },
      ],
    })
  })

  it('carries the search truncation flag and an absent answer', () => {
    const model = webCardModel(settledSearch({ resultView: { card: 'web', kind: 'search', truncated: true, sources: [] } }))
    expect(model).toEqual({ kind: 'search', answer: undefined, truncated: true, sources: [] })
  })

  it('derives a fetch card from the result view', () => {
    expect(webCardModel(settledFetch())).toEqual({
      kind: 'fetch', url: 'https://example.com/page', statusCode: 200, truncated: false,
    })
    expect(webCardModel(settledFetch({ resultView: resultFetch({ statusCode: 404, truncated: true }) })))
      .toEqual({ kind: 'fetch', url: 'https://example.com/page', statusCode: 404, truncated: true })
  })

  it('returns null for a running call, since the web card is result-only', () => {
    expect(webCardModel(runningSearch())).toBeNull()
    // Even a running call that somehow carried a web call view stays generic:
    // the derivation reads resultView only.
    expect(webCardModel(runningSearch({ callView: null }))).toBeNull()
  })

  it('returns null for a settled call whose result view is not a web card', () => {
    expect(webCardModel(settledSearch({ resultView: null }))).toBeNull()
    expect(webCardModel(settledSearch({ resultView: { card: 'generic' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire; the
    // documented generic-card default takes it, not a crash.
    const future = { card: 'chart', kind: 'search' } as unknown as ToolResultView
    expect(webCardModel(settledSearch({ resultView: future }))).toBeNull()
    // A web card whose kind this UI version does not know (a newer host's
    // value) also takes the generic path, not a malformed fetch.
    const futureKind = { card: 'web', kind: 'timeline' } as unknown as ToolResultView
    expect(webCardModel(settledSearch({ resultView: futureKind }))).toBeNull()
  })
})

describe('chat row web body', () => {
  const ownerProps = (block: RunningToolCall | ToolResultNode, toolName: string): ToolCallOwnerProps => ({
    callId: block.callId, toolName, block, openFile: vi.fn(),
  })
  // WebRow reads only toolName/block off the full runtime share plus the locale
  // seat; the standard kit is unused, so the cast supplies the owner slice and
  // `t` alone (as BashRow's tests do for the terminal card).
  const rowProps = (block: RunningToolCall | ToolResultNode, toolName: string): Parameters<typeof WebRow>[0] =>
    ({ ...ownerProps(block, toolName), t } as unknown as Parameters<typeof WebRow>[0])

  /** The whole summary row is the expand toggle (ToolRow's unified interaction). */
  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('the WebRow collapses to the summary row, expanding to the full search card', () => {
    const globe = render(<IconGlobeOutline14 />).container.querySelector('svg')!.outerHTML
    const view = render(<WebRow {...rowProps(settledSearch(), 'web_search')} />)
    // Collapsed: the summary row alone, no card in the DOM.
    expect(view.getByText('Search')).toBeTruthy()
    expect(view.container.querySelector('svg')?.outerHTML).toBe(globe)
    expect(view.queryByText('Titled')).toBeNull()
    expect(view.container.querySelector('[data-web]')).toBeNull()
    toggleRow(view)
    // Expanded: the resident search card with every source field.
    expect(view.getByText('Titled')).toBeTruthy()
    expect(view.getByText('excerpt')).toBeTruthy()
    // hostname fallback for the source with no title
    expect(view.getByText('plain.example.org')).toBeTruthy()
  })

  it('the WebRow expands to the fetch card, titled Fetch', () => {
    const view = render(<WebRow {...rowProps(settledFetch(), 'web_fetch')} />)
    expect(view.getByText('Fetch')).toBeTruthy()
    expect(view.container.querySelector('[data-web]')).toBeNull()
    toggleRow(view)
    // The url shows as the card's link; scope to the card.
    const card = view.container.querySelector('[data-web="fetch"]')
    expect(card?.querySelector('a')?.getAttribute('href')).toBe('https://example.com/page')
    expect(view.getByText('HTTP 200')).toBeTruthy()
  })

  it('a running web call is the summary row alone, with nothing to expand', () => {
    const view = render(<WebRow {...rowProps(runningSearch(), 'web_search')} />)
    expect(view.getByText('Search')).toBeTruthy()
    expect(view.queryByText('Titled')).toBeNull()
    // No card material and no expandable body: clicking the row reveals nothing.
    expect(view.container.querySelector('[data-expandable]')).toBeNull()
    expect(view.container.querySelector('[data-web]')).toBeNull()
  })

  it('a failed web call keeps the summary row without the card', () => {
    const view = render(<WebRow {...rowProps(settledSearch({
      isError: true, resultView: { card: 'generic' },
    }), 'web_search')} />)
    expect(view.getByText('Search')).toBeTruthy()
    expect(view.container.querySelector('[data-web]')).toBeNull()
    // The row reflects the error state so the summary line still reads as failed.
    expect(view.container.querySelector('[data-state="error"]')).not.toBeNull()
  })

  it('the GenericToolCard fallback also expands to a web card for a web-declaring tool', () => {
    // A web-declaring tool without its own keyed row lands on the fallback; its
    // card routes through the same collapsed-by-default ToolRow.
    const view = render(<GenericToolCard {...ownerProps(settledSearch({
      call: { name: 'fx-web', argsRaw: SEARCH_ARGS },
    }), 'fx-web')} t={t} />)
    expect(view.container.querySelector('[data-web]')).toBeNull()
    toggleRow(view)
    expect(view.getByText('Titled')).toBeTruthy()
    expect(view.container.querySelector('[data-web="search"]')).not.toBeNull()
  })

  it('the GenericToolCard fallback keeps the plain row for a non-web call', () => {
    const view = render(<GenericToolCard {...ownerProps(settledSearch({
      call: { name: 'echo', argsRaw: '{}' }, callView: null, resultView: null,
    }), 'echo')} t={t} />)
    expect(view.container.querySelector('[data-web]')).toBeNull()
  })
})

describe('DetailsPanel web Output section', () => {
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

  it('renders the search card at full source allowance', () => {
    const view = mount(snapshot({ nodes: [settledSearch()] }), { turnSeq: 10, callId: 'c1', toolName: 'web_search' })
    expect(view.getByText('Titled')).toBeTruthy()
    expect(view.getByText('excerpt')).toBeTruthy()
    // The Input JSON section survives beside it.
    expect(view.getByText(/"query"/)).toBeTruthy()
  })

  it('renders the fetch card and keeps the fetched body below it', () => {
    const view = mount(snapshot({ nodes: [settledFetch()] }), { turnSeq: 11, callId: 'c2', toolName: 'web_fetch' })
    const card = view.container.querySelector('[data-web="fetch"]')
    expect(card?.querySelector('a')?.getAttribute('href')).toBe('https://example.com/page')
    expect(view.getByText('HTTP 200')).toBeTruthy()
    // The card is a summary (URL + status only); the panel is the single-call
    // reading surface, so the fetched body still renders below the card.
    const output = view.getByText('输出').closest('section')
    expect(output?.querySelector('pre')?.textContent).toContain('fetch body')
  })

  it('a non-web result keeps the flattened pre form', () => {
    const view = mount(snapshot({
      nodes: [settledSearch({ callView: null, resultView: null })],
    }), { turnSeq: 10, callId: 'c1', toolName: 'web_search' })
    expect(view.container.querySelector('[data-web]')).toBeNull()
    const output = view.getByText('输出').closest('section')
    expect(output?.querySelector('pre')?.textContent).toContain('search text')
  })
})

describe('web toolview registration', () => {
  it('registers one WebRow under both web_search and web_fetch', () => {
    const registered: { key: string; locale: unknown; component: unknown }[] = []
    const ctx = {
      slots: {
        inject: (_name: string, callback: () => Iterable<() => void>) => {
          for (const _dispose of callback()) { /* exhaust transactional setup */ }
          return () => undefined
        },
        register: (options: { name: string; key: string; locale?: string }, component: unknown) => {
          registered.push({ key: options.key, locale: options.locale, component })
          return () => {}
        },
      },
    } as unknown as import('@deepseek-ai/cordis').Context
    webToolview.apply(ctx)
    expect(registered.map(r => r.key)).toEqual(['web_search', 'web_fetch'])
    // Both keys claim the conversation locale seat ToolRow's body copy needs.
    expect(registered.map(r => r.locale)).toEqual(['conversation', 'conversation'])
    // One component under both keys, not two thin rows.
    expect(registered[0]?.component).toBe(WebRow)
    expect(registered[1]?.component).toBe(WebRow)
    expect(webToolview.inject).toEqual(['slots'])
  })
})
