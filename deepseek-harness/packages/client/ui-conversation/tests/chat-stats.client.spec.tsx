// @vitest-environment jsdom
// StatsLine (composer.dock entry): totals derivation + the RFC hard
// acceptance — zero renders during streaming.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type {
  AssistantMessageNode, ConversationSnapshot, SessionId, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { EMPTY_CONVERSATION_VIEWS } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { StatsLine, contextOccupancy, deriveStats, formatDuration, formatTokens, type StatsLineProps } from '../src/client/chat/StatsLine.tsx'
import { en, zh } from '../src/client/locales.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

// Mirrors the real lookup chain (conversation namespace, then common).
const t: StatsLineProps['t'] = makeTranslate(zh, commonZh)
const tEn: StatsLineProps['t'] = makeTranslate(en, commonEn)

/** jsdom has no ResizeObserver; StatsLine watches its row for ellipsis truncation through one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const SID = 's1' as SessionId

const assistant = (seq: number, turn: number, usage?: unknown): AssistantMessageNode => ({
  kind: 'assistant', seq, time: seq * 1_000, turn, step: seq, blocks: [{ kind: 'text', text: `t${seq}` }],
  ...(usage === undefined ? {} : { usage }),
})

function snapshotBase(): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: chatSnapshotFixture(),
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false, openState: 'open', openError: null,
    hasMore: false, loadingOlder: false, promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

function makeSource(init?: Partial<ConversationSnapshot>) {
  const initial = { ...snapshotBase(), ...init }
  let snap: ConversationSnapshot = {
    ...initial,
    chat: init?.chat ?? chatSnapshotFixture({
      nodes: initial.nodes,
      partial: initial.partial,
      runningCalls: initial.runningCalls,
      turnTimings: initial.turnTimings,
      turnEnds: initial.turnEnds,
    }),
  }
  const subs = new Set<() => void>()
  return {
    set: (next: Partial<ConversationSnapshot>) => {
      const merged = { ...snap, ...next }
      snap = {
        ...merged,
        chat: next.chat ?? (next.nodes === undefined ? snap.chat : chatSnapshotFixture({
          nodes: merged.nodes,
          partial: merged.partial,
          runningCalls: merged.runningCalls,
          turnTimings: merged.turnTimings,
          turnEnds: merged.turnEnds,
        })),
      }
      for (const fn of [...subs]) fn()
    },
    source: {
      getSnapshot: () => snap,
      subscribe: (fn: () => void) => {
        subs.add(fn)
        return () => subs.delete(fn)
      },
    },
  }
}

describe('deriveStats', () => {
  it('counts turns and steps and never folds node usage into accounting', () => {
    const stats = deriveStats([
      assistant(1, 1, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 900 }),
      assistant(2, 1, { inputTokens: 100, outputTokens: 50 }),
      assistant(3, 2),
    ])
    expect(stats.turns).toBe(2)
    expect(stats.steps).toBe(3)
    // The window fold's counts are only the fallback for assemblies without
    // the sessionStats projection; the paged window is not an accounting
    // source either, so the fold exposes no billing fields (billing rides the
    // tokenUsage projection); decodeTokens is a throughput input, not a
    // billed total.
    expect(Object.keys(stats).sort()).toEqual(
      ['decodeMs', 'decodeTokens', 'llmMs', 'steps', 'toolMs', 'ttftMs', 'ttftSteps', 'turns'],
    )
  })

  it('ignores tool results with no call time', () => {
    const tool: ToolResultNode = {
      kind: 'tool-result', seq: 5, time: 5_000, callId: 'c', call: null, callTime: null, content: [],
      isError: false, callView: null, resultView: null, subCalls: [],
    }
    const stats = deriveStats([tool, assistant(1, 1)])
    expect(stats.steps).toBe(1)
    expect(stats.toolMs).toBe(0)
  })

  it('sums LLM wall time from assistant timing and tool wall time from call/result pairs', () => {
    const timed: AssistantMessageNode = {
      ...assistant(1, 1),
      timing: { stepStartTime: 1_000, firstTokenTime: 1_200, completedTime: 3_500 },
    }
    const untimed: AssistantMessageNode = {
      ...assistant(2, 1),
      timing: { stepStartTime: null, firstTokenTime: null, completedTime: 9_000 },
    }
    const tool: ToolResultNode = {
      kind: 'tool-result', seq: 5, time: 7_000, callId: 'c', call: null, callTime: 4_000, content: [],
      isError: false, callView: null, resultView: null, subCalls: [],
    }
    const stats = deriveStats([timed, untimed, tool])
    expect(stats.llmMs).toBe(2_500)
    expect(stats.toolMs).toBe(3_000)
  })

  it('sums ttft per recorded step and decode throughput inputs per usage-carrying step', () => {
    const sampled: AssistantMessageNode = {
      ...assistant(1, 1, { outputTokens: 40 }),
      timing: { stepStartTime: 1_000, firstTokenTime: 1_800, completedTime: 4_800 },
    }
    const ttftOnly: AssistantMessageNode = {
      ...assistant(2, 1),
      timing: { stepStartTime: 5_000, firstTokenTime: 5_400, completedTime: 7_400 },
    }
    const stats = deriveStats([sampled, ttftOnly, assistant(3, 2)])
    expect(stats.ttftMs).toBe(1_200)
    expect(stats.ttftSteps).toBe(2)
    // The usage-less step contributes no decode share, keeping the ratio honest.
    expect(stats.decodeMs).toBe(3_000)
    expect(stats.decodeTokens).toBe(40)
  })
})

describe('formatters', () => {
  it('formats token counts compactly', () => {
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(12_240)).toBe('12.2K')
    expect(formatTokens(517_000)).toBe('517K')
    expect(formatTokens(1_230_000)).toBe('1.2M')
  })

  it('formats durations under and over a minute', () => {
    expect(formatDuration(45_230)).toBe('45.2s')
    expect(formatDuration(162_000)).toBe('2m42s')
  })
})

describe('StatsLine', () => {
  const USAGE = { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 90, cacheWriteTokens: 0 }

  /** A whole-log sessionStats value: zeros plus overrides. */
  function sessionStats(overrides: Record<string, number>): Record<string, number> {
    return {
      turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
      ...overrides,
    }
  }

  /** Stub the projection seat: a key-addressed table of whole values. */
  function projections(values: Record<string, unknown>): StatsLineProps['useProjection'] {
    return (key: string) => values[key]
  }

  function props(
    source: { getSnapshot(): ConversationSnapshot; subscribe(fn: () => void): () => void },
    values: Record<string, unknown> = { tokenUsage: USAGE },
  ): StatsLineProps {
    return { useSession: bindSnapshotSelector(source), useProjection: projections(values), t: tEn }
  }

  it('renders the grouped stats row and hides a brand-new empty session', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsLine {...props(source)} />)
    // No timing on the fixture: the duration group drops out whole. Tokens come
    // from the projection, so paging the window cannot change them.
    expect(view.container.textContent).toBe('1 turns · 1 steps| Cache hit 90%| Input 100 tok · Output 5 tok')
    const empty = makeSource()
    const emptyView = render(<StatsLine {...props(empty.source, {
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      contextPressure: {},
    })} />)
    expect(emptyView.container.textContent).toBe('')
  })

  it('reveals the full line in a delayed hover tooltip only while the row is clipped', () => {
    vi.useFakeTimers()
    // jsdom lays nothing out; fake a row narrower than its content.
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(800)
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(400)
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsLine {...props(source)} />)
    fireEvent.mouseEnter(view.container.firstElementChild!)
    act(() => { vi.advanceTimersByTime(499) })
    expect(view.container.querySelector('[role="tooltip"]')).toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(view.container.querySelector('[role="tooltip"]')?.textContent)
      .toBe('1 turns · 1 steps | Cache hit 90% | Input 100 tok · Output 5 tok')
  })

  it('suppresses the tooltip while the row fits without truncation', () => {
    vi.useFakeTimers()
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsLine {...props(source)} />)
    fireEvent.mouseEnter(view.container.firstElementChild!)
    act(() => { vi.advanceTimersByTime(500) })
    expect(view.container.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('renders window latency and throughput beside the wall-time group', () => {
    const timed: AssistantMessageNode = {
      ...assistant(1, 1, { outputTokens: 60 }),
      timing: { stepStartTime: 1_000, firstTokenTime: 1_800, completedTime: 4_800 },
    }
    const { source } = makeSource({ nodes: [timed] })
    const view = render(<StatsLine {...props(source)} />)
    expect(view.container.textContent).toContain('LLM 3.8s| TTFT avg 0.8s · 20 tok/s')
  })

  it('takes every stats label from the active locale', () => {
    const timed: AssistantMessageNode = {
      ...assistant(1, 1, { outputTokens: 60 }),
      timing: { stepStartTime: 1_000, firstTokenTime: 1_800, completedTime: 4_800 },
    }
    const { source } = makeSource({ nodes: [timed] })
    const view = render(<StatsLine {...props(source)} t={t} />)
    expect(view.container.textContent)
      .toBe('1 轮 · 1 步| LLM 3.8s| 首 token 平均 0.8s · 20 tok/s| 缓存命中 90%| 输入 100 tok · 输出 5 tok')
  })

  it('renders without ResizeObserver support', () => {
    vi.unstubAllGlobals()
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    expect(() => render(<StatsLine {...props(source)} />)).not.toThrow()
  })

  it('keeps durable token groups after the visible step window is empty', () => {
    const { source } = makeSource()
    const view = render(<StatsLine {...props(source, {
      tokenUsage: USAGE,
      contextPressure: { pressureTokens: 32_000, contextWindow: 128_000 },
    })} />)
    // Context occupancy lives on the composer's ContextMeter ring, not here.
    expect(view.container.textContent)
      .toBe('Cache hit 90%| Input 100 tok · Output 5 tok')
  })

  it('computes context occupancy only when both a numerator and capacity are known', () => {
    // The projected figure wins: it is the provider sample carried forward over
    // the surface's movement, so a compaction shows without waiting a request.
    expect(contextOccupancy({ pressureTokens: 32_000, projectedTokens: 6_000, contextWindow: 128_000 }))
      .toEqual({ percent: 5, usedTokens: 6_000, contextWindow: 128_000 })
    // A log whose projection predates the field still reads its bare sample.
    expect(contextOccupancy({ pressureTokens: 32_000, contextWindow: 128_000 }))
      .toEqual({ percent: 25, usedTokens: 32_000, contextWindow: 128_000 })
    // A numerator without capacity has no denominator; capacity without a
    // provider sample has no numerator yet, rather than a synthetic 0%.
    expect(contextOccupancy({ pressureTokens: 32_000 })).toBeNull()
    expect(contextOccupancy({ contextWindow: 128_000 })).toBeNull()
    expect(contextOccupancy(undefined)).toBeNull()
    // Capacity and the sample are independent last-wins fields, so a model
    // switch can pair a smaller new window with the previous route's prompt.
    expect(contextOccupancy({ pressureTokens: 300_000, contextWindow: 128_000 })?.percent).toBe(100)
  })

  it('drops every token group when no projection is composed', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsLine {...props(source, {})} />)
    expect(view.container.textContent).toBe('1 turns · 1 steps')
  })

  it('renders whole-session counts from the sessionStats projection over the paged window', () => {
    // The bug's acceptance at unit level: one loaded page must not scope the
    // counter — the durable projection's totals win over the window fold.
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsLine {...props(source, {
      tokenUsage: USAGE,
      sessionStats: sessionStats({ turns: 10, steps: 89 }),
    })} />)
    expect(view.container.textContent)
      .toBe('10 turns · 89 steps| Cache hit 90%| Input 100 tok · Output 5 tok')
  })

  it('treats a defined zero-count projection as empty, not as fallback', () => {
    // A composed unit always serves the key; all-zero genuinely means no
    // closed step in the whole log, so nothing renders on a brand-new session.
    const empty = makeSource()
    const view = render(<StatsLine {...props(empty.source, {
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      sessionStats: sessionStats({}),
    })} />)
    expect(view.container.textContent).toBe('')
  })

  it('hides the zero-token group when steps closed without any billed activity', () => {
    // A session whose only turn failed before billing (e.g. an auth error):
    // the counts group renders alone, not an uninformative zero-token group.
    const { source } = makeSource()
    const view = render(<StatsLine {...props(source, {
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      sessionStats: sessionStats({ turns: 1, steps: 1 }),
    })} />)
    expect(view.container.textContent).toBe('1 turns · 1 steps')
  })

  it('keeps the counts group over an empty visible window when the projection carries totals', () => {
    // Extends the durable-groups guarantee: full-session counts survive a
    // window that compaction (or paging) left without assistant nodes.
    const { source } = makeSource()
    const view = render(<StatsLine {...props(source, {
      tokenUsage: USAGE,
      sessionStats: sessionStats({ turns: 7, steps: 44 }),
    })} />)
    expect(view.container.textContent)
      .toBe('7 turns · 44 steps| Cache hit 90%| Input 100 tok · Output 5 tok')
  })

  it('renders whole-log wall times and speeds from the projection, not the loaded window', () => {
    // The 加载更早 hazard beyond counts: LLM/tool durations and the TTFT and
    // throughput figures must not grow per loaded page either. An untimed
    // 1-node window renders the projection's whole-log figures verbatim.
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsLine {...props(source, {
      tokenUsage: USAGE,
      sessionStats: sessionStats({
        turns: 200, steps: 200, llmMs: 100_000, toolMs: 62_000,
        ttftMs: 1_600, ttftSteps: 2, decodeMs: 3_000, decodeTokens: 60,
      }),
    })} />)
    expect(view.container.textContent).toBe(
      '200 turns · 200 steps| LLM 1m40s · Tool call 1m2s| TTFT avg 0.8s · 20 tok/s| Cache hit 90%| Input 100 tok · Output 5 tok',
    )
  })

  it('omits cache hit when nothing was billed on the input side', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsLine {...props(source, {
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })} />)
    expect(view.container.textContent).toBe('1 turns · 1 steps| Input 0 tok · Output 7 tok')
  })

  it('includes cache writes in billed input and the cache-hit denominator', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsLine {...props(source, {
      tokenUsage: {
        uncachedInputTokens: 10,
        outputTokens: 7,
        cacheReadTokens: 90,
        cacheWriteTokens: 100,
      },
    })} />)
    expect(view.container.textContent)
      .toBe('1 turns · 1 steps| Cache hit 45%| Input 200 tok · Output 7 tok')
  })

  it('renders ZERO times during streaming chunk frames (RFC hard acceptance)', () => {
    const { set, source } = makeSource({ nodes: [assistant(1, 1)] })
    let renders = 0
    function Counting(p: StatsLineProps) {
      renders += 1
      return <StatsLine {...p} />
    }
    render(<Counting {...props(source)} />)
    const before = renders
    // Chunk frames swap partial only; nodes keeps its reference (object-layer contract).
    act(() => { set({ partial: { turn: 1, step: 2, blocks: [{ kind: 'text', text: 'a' }] } }) })
    act(() => { set({ partial: { turn: 1, step: 2, blocks: [{ kind: 'text', text: 'ab' }] } }) })
    act(() => { set({ running: true }) })
    expect(renders).toBe(before)
  })
})
