/**
 * Tool-card view computation over the mux live path: three standard card types
 * arrive on the frame, a presenterless tool ships no view field, a call-only
 * presenter keeps raw result content out of the view payload, and a throwing
 * presenter soft-falls to no view (the event still ships). Result pairing
 * works both through the live open-call table and the backscan fallback after
 * turn/end cleared it.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { CallId, createMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const reply = (text: string): Promise<ContentBlock[]> => Promise.resolve([{ type: 'text', text }])

function tool(name: string, presenters: Pick<ToolDefinition, 'presentCall' | 'presentResult'>): ToolDefinition {
  return defineContentToolFixture({
    name,
    description: `tool ${name}`,
    parameters: {},
    execute: () => reply(`ran:${name}`),
    ...presenters,
  })
}

/** Append a production-shaped human prompt to the session surface. */
function appendUserText(session: Session, text: string): SessionEvent {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** Append a production-shaped assistant message to the session surface. */
function appendAssistantText(session: Session, text: string, step: number): SessionEvent {
  return session.append('assistant/message', {
    turn: 1,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'p', model: 'm' },
    }),
  }, { surfaceOp: 'append' })
}

/**
 * Append a plugin-owned log-only event. The host proxy is projection-only, so it
 * declares no compaction vocabulary; the cast writes the real event shape without
 * depending on the owning package.
 */
function appendExtension(session: Session, type: string, data: unknown): SessionEvent {
  return (session.append as unknown as (type: string, data: unknown) => SessionEvent)(type, data)
}

async function harness(): Promise<{ ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  ctx.tools.register(tool('gen', {
    presentCall: () => ({ card: 'generic', title: 'gen call' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'gen failed' : 'gen done' }),
  }))
  ctx.tools.register(tool('term', {
    presentCall: args => ({ card: 'terminal', title: (args as { cmd?: string }).cmd ?? '' }),
    presentResult: () => ({ card: 'terminal', output: 'done' }),
  }))
  ctx.tools.register(tool('diffy', {
    presentCall: () => ({ card: 'diff', title: 'Write f.txt', diffs: [{ path: 'f.txt', oldText: null, newText: 'x' }] }),
  }))
  ctx.tools.register(tool('call-only', {
    presentCall: () => ({ card: 'generic', title: 'program', kind: 'execute', rawInput: 'return value' }),
  }))
  ctx.tools.register(tool('plain', {}))
  ctx.tools.register(tool('boom', {
    presentCall: () => { throw new Error('presenter exploded') },
  }))
  return { ctx }
}

/** Drain frames from an open mux stream until `count` session/event frames arrived. */
async function collect(iterable: AsyncIterable<RpcRequest<MuxFrame>>, count: number, abort: AbortController): Promise<MuxFrame[]> {
  const frames: MuxFrame[] = []
  for await (const frame of iterable) {
    frames.push(frame.payload)
    if (frames.filter(f => f.type === 'session/event').length >= count) abort.abort()
  }
  return frames
}

describe('mux live view computation', () => {
  it('attaches the three standard card views, omits view without a presenter, soft-falls on throw', async () => {
    const { ctx } = await harness()
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    const abort = new AbortController()
    const stream = api.events.mux({ rpcId: RpcId('t-mux'), payload: {} }, abort.signal)
    const collected = collect(stream, 9, abort)
    const rawResult = `RAW_RESULT:${'x'.repeat(64 * 1024)}`

    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-gen'), name: 'gen', arguments: '{}' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-term'), name: 'term', arguments: '{"cmd":"echo hi"}' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-diff'), name: 'diffy', arguments: '{}' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-call-only'), name: 'call-only', arguments: '{}' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('c-call-only'),
        content: [{ type: 'text', text: rawResult }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-plain'), name: 'plain', arguments: '{}' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-boom'), name: 'boom', arguments: '{}' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('c-gen'),
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })

    const frames = await collected
    const events = frames.filter(f => f.type === 'session/event')
    const byCall = new Map(events
      .filter(f => f.event.type === 'tool/call' || f.event.type === 'tool/result')
      .map(f => [
        `${f.event.type}:${f.event.type === 'tool/call'
          ? f.event.data.callId
          : (f.event.data as SessionEvent<'tool/result'>['data']).message.source.callId}`,
        f,
      ]))

    expect(byCall.get('tool/call:c-gen')?.view).toEqual({ for: 'call', view: { card: 'generic', title: 'gen call' } })
    expect(byCall.get('tool/call:c-term')?.view).toEqual({ for: 'call', view: { card: 'terminal', title: 'echo hi' } })
    expect(byCall.get('tool/call:c-diff')?.view?.view.card).toBe('diff')
    expect(byCall.get('tool/call:c-call-only')?.view).toEqual({
      for: 'call',
      view: { card: 'generic', title: 'program', kind: 'execute', rawInput: 'return value' },
    })
    const callOnlyResult = byCall.get('tool/result:c-call-only')
    expect('view' in (callOnlyResult ?? {})).toBe(false)
    const serializedResult = JSON.stringify(callOnlyResult)
    expect(serializedResult.indexOf(rawResult)).toBeGreaterThanOrEqual(0)
    expect(serializedResult.indexOf(rawResult)).toBe(serializedResult.lastIndexOf(rawResult))
    // No presenter → the frame carries no view property at all.
    expect('view' in (byCall.get('tool/call:c-plain') ?? {})).toBe(false)
    // Throwing presenter → soft-fall: event ships, no view.
    expect(byCall.get('tool/call:c-boom')).toBeDefined()
    expect('view' in (byCall.get('tool/call:c-boom') ?? {})).toBe(false)
    // Result pairing through the live table: presentResult saw the call's args.
    expect(byCall.get('tool/result:c-gen')?.view).toEqual({ for: 'result', view: { card: 'generic', title: 'gen done' } })
  })

  it('serves history entries with call/result views, backscan pairing, and soft-falls', async () => {
    const { ctx } = await harness()
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    const session = ctx.sessions.create()
    // history resolves the agent first; a live structural stub is enough (only
    // .session is read on this path).
    ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('h-term'), name: 'term', arguments: '{"cmd":"ls"}' })
    // meta rides through to presentResult's ToolResult (the spread arm).
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('h-term'),
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
      meta: { n: 1 },
    }, { surfaceOp: 'append' })
    // Unpaired result: no tool/call with this id anywhere in the page.
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('h-orphan'),
        content: [{ type: 'text', text: 'x' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    // Paired, but the call's stored arguments do not parse: backscan soft-falls.
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('h-bad'), name: 'term', arguments: '{broken' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('h-bad'),
        content: [{ type: 'text', text: 'y' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    // Presenterless tool: pairing succeeds but presentResult is absent.
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('h-plain'), name: 'plain', arguments: '{}' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('h-plain'),
        content: [{ type: 'text', text: 'z' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })

    const response = await api.sessions.history({ rpcId: RpcId('t-hist'), payload: { sessionId: session.id } })
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    const entries = response.result.value.events
    const byKey = new Map(entries
      .filter(entry => entry.event.type === 'tool/call' || entry.event.type === 'tool/result')
      .map(entry => [
        `${entry.event.type}:${entry.event.type === 'tool/call'
          ? entry.event.data.callId
          : (entry.event.data as SessionEvent<'tool/result'>['data']).message.source.callId}`,
        entry,
      ]))
    expect(byKey.get('tool/call:h-term')?.view).toEqual({ for: 'call', view: { card: 'terminal', title: 'ls' } })
    expect(byKey.get('tool/result:h-term')?.view).toEqual({ for: 'result', view: { card: 'terminal', output: 'done' } })
    expect('view' in (byKey.get('tool/result:h-orphan') ?? {})).toBe(false)
    expect('view' in (byKey.get('tool/result:h-bad') ?? {})).toBe(false)
    expect('view' in (byKey.get('tool/result:h-plain') ?? {})).toBe(false)
  })

  it('counts only append-origin messages toward maxMessages and keeps each compaction summary with its replacement', async () => {
    const { ctx } = await harness()
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    const session = ctx.sessions.create()
    ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    session.append('turn/start', { turn: 1 })
    const first = appendUserText(session, 'first prompt')
    appendAssistantText(session, 'first reply', 1)
    const third = appendUserText(session, 'second prompt')
    appendAssistantText(session, 'second reply', 2)
    const shadowed = [...session.surface.nodes]
    // A compaction transaction: a log-only summary record immediately followed by the
    // replacement that shadows the range.
    const summary = appendExtension(session, 'compaction/summary', {
      summary: [{ type: 'text', text: 'summary' }],
      shadowedRange: { start: shadowed[0], end: shadowed.at(-1) },
      shadowedSeqs: shadowed,
      shadowedTokenCount: 0,
      provider: 'p',
      model: 'm',
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '<context_checkpoint>summary</context_checkpoint>' }],
      source: { kind: 'plugin', plugin: 'compact' },
    }), {
      surfaceOp: { op: 'replace', start: shadowed[0] as number, end: shadowed.at(-1) as number },
      sourceEventSeqs: [...shadowed, summary.seq],
    })

    const response = await api.sessions.history({
      rpcId: RpcId('t-hist-compact'),
      payload: { sessionId: session.id, maxMessages: 2 },
    })
    if (!response.result.ok) throw new Error('unreachable')
    const page = response.result.value.events.map(entry => entry.event)
    // Two append-origin messages fill the page even though a replacement copy of
    // the same event type sits in the window: the copy is model-only.
    const messages = page.filter(event => event.type === 'user/message' || event.type === 'assistant/message')
    expect(messages.map(event => event.seq)).toEqual([third.seq, third.seq + 1, third.seq + 3])
    expect(page.some(event => event.seq === first.seq)).toBe(false)
    expect(response.result.value.hasMore).toBe(true)
    // The range stays contiguous, so the checkpoint's summary record is readable on
    // the same page as the checkpoint itself.
    const summaryIndex = page.findIndex(event => event.seq === summary.seq)
    expect(summaryIndex).toBeGreaterThan(-1)
    expect(page[summaryIndex + 1]?.seq).toBe(summary.seq + 1)
    expect(page.map(event => event.seq)).toEqual(page.map((_event, index) => third.seq + index))
  })

  it('paginates a message with many provenance sources without variadic argument expansion', async () => {
    const { ctx } = await harness()
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    const session = ctx.sessions.create()
    ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    session.append('turn/start', { turn: 1 })
    const sources = Array.from({ length: 128 }, (_unused, index) => session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index, text: 'x' },
    }).seq)
    const message = session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'x'.repeat(sources.length) }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: sources })

    const scalarMin = Math.min
    const min = vi.spyOn(Math, 'min').mockImplementation((...values) => {
      if (values.length > 2) throw new RangeError('variadic minimum rejected by regression harness')
      return scalarMin(...values)
    })
    try {
      const response = await api.sessions.history({
        rpcId: RpcId('t-hist-large-provenance'),
        payload: { sessionId: session.id, maxMessages: 1 },
      })
      if (!response.result.ok) throw new Error('unreachable')
      expect(response.result.value.events.map(entry => entry.event.seq)).toEqual([...sources, message.seq])
      expect(response.result.value.hasMore).toBe(true)
    } finally {
      min.mockRestore()
    }
  })

  it('drops a disposed session from the live open-call table (result after dispose gets no view)', async () => {
    const { ctx } = await harness()
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    const abort = new AbortController()
    const stream = api.events.mux({ rpcId: RpcId('t-mux3'), payload: {} }, abort.signal)

    let session: Session | undefined
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      session = inner.sessions.create('session-doomed' as SessionId)
    }, { inject: ['sessions'] }))
    session?.append('turn/start', { turn: 1 })
    session?.append('tool/call', { turn: 1, step: 1, callId: CallId('c-doomed'), name: 'term', arguments: '{"cmd":"x"}' })
    // Disposing the owning fiber detaches the session mid-stream; the
    // session/disposed listener must clear its open-call table entry.
    await fiber.dispose()

    const frames = await collect(stream, 2, abort)
    const call = frames.find(f => f.type === 'session/event' && f.event.type === 'tool/call')
    expect(call?.type === 'session/event' && call.view?.for).toBe('call')
  })

  it('pairs a result after turn/end via the in-memory backscan fallback', async () => {
    const { ctx } = await harness()
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    const abort = new AbortController()
    const stream = api.events.mux({ rpcId: RpcId('t-mux2'), payload: {} }, abort.signal)
    const collected = collect(stream, 4, abort)

    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-late'), name: 'term', arguments: '{"cmd":"tail"}' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // The turn/end above cleared the live table; pairing must fall back to
    // scanning the session's in-memory events.
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: CallId('c-late'),
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })

    const frames = await collected
    const result = frames.find(f => f.type === 'session/event' && f.event.type === 'tool/result')
    expect(result?.type === 'session/event' && result.view).toEqual({ for: 'result', view: { card: 'terminal', output: 'done' } })
  })
})
