/**
 * Projection carrier paths of the host ApiProxy: the history tail page's
 * projections block reads the registry's watermark snapshot (asOfSeq = last
 * event seq, one consistent cut); loadOlder pages never carry the block; a
 * composition without the registry serves histories without it; a disposed
 * registration's key leaves subsequent responses; and every unit change is
 * pushed to mux consumers as a session/projection frame minted here.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'test/last-user': { text: string } | null
  }
}

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`proj-${String(nextRpc++)}`), payload }
}

/** Whole-value unit folding the latest user/message text; null before the first. */
type LastUserState = { text: string } | null
const lastUserUnit = (): ProjectionDefinition<'test/last-user', LastUserState> => ({
  key: 'test/last-user',
  schema: z.union([z.object({ text: z.string() }), z.null()]),
  init: () => null,
  apply: (state, event) => (event.type === 'user/message'
    ? { text: (event.data.content[0] as { text?: string }).text ?? '' }
    : state),
  view: state => state,
  stateVersion: 1,
})

async function harness(withRegistry: boolean): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  if (withRegistry) await ctx.plugin(SessionProjectionRegistry)
  const session = ctx.sessions.create()
  // The gateway reads both the session and durable inbox baseline.
  ctx.agents.register({ id: session.id, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }), status: 'idle', ctx } as Agent)
  return { ctx, session }
}

/** Append `count` user messages so the log has paginable message boundaries. */
function seedMessages(session: Session, count: number): void {
  for (let i = 0; i < count; i++) {
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `m${i}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
  }
}

const api = (ctx: Context) => createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

describe('session.history projections block', () => {
  it('serves the unit value on the tail page with asOfSeq = last event seq', async () => {
    const { ctx, session } = await harness(true)
    ctx.sessionProjections.register(lastUserUnit())
    seedMessages(session, 3)
    const response = await api(ctx).sessions.history(request({ sessionId: session.id }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    const { events, projections } = response.result.value
    expect(projections).toBeDefined()
    expect(projections?.asOfSeq).toBe(session.seq - 1)
    expect(projections?.values['test/last-user']).toEqual({ text: 'm2' })
    // asOfSeq IS the window tail: the last served event carries it.
    expect(events.at(-1)?.event.seq).toBe(projections?.asOfSeq)
  })

  it('publishes the attachments imageLimits as a constant unit while both seams are composed', async () => {
    const { ctx, session } = await harness(true)
    const limits = {
      maxImageBytes: 5 * 1024 * 1024,
      maxImagesPerMessage: 20,
      maxMessageImageBytes: 100 * 1024 * 1024,
      maxImagePixels: 40_000_000,
      mediaTypes: ['image/png'] as const,
    }
    await ctx.plugin(class extends AttachmentStore {
      readonly imageLimits = limits
      validateImage(): Promise<void> { return Promise.resolve() }
      saveImage(): Promise<never> { return Promise.reject(new Error('unused')) }
      readImage(): Promise<never> { return Promise.reject(new Error('unused')) }
    })
    const gateway = api(ctx)
    seedMessages(session, 2)
    const response = await gateway.sessions.history(request({ sessionId: session.id }))
    if (!response.result.ok) throw new Error('history failed')
    expect(response.result.value.projections?.values['imageLimits']).toEqual(limits)
    // Constant unit: appending events must never broadcast an imageLimits frame.
    await new Promise(resolve => setTimeout(resolve, 0))
    const abort = new AbortController()
    const stream = gateway.events.mux({ rpcId: RpcId('t-limits-mux'), payload: {} }, abort.signal)
    const frames: MuxFrame[] = []
    const drained = (async () => {
      for await (const envelope of stream) {
        frames.push(envelope.payload)
        if (frames.some(f => f.type === 'session/event')) abort.abort()
      }
    })().catch(() => {})
    seedMessages(session, 1)
    await drained
    expect(frames.some(f => f.type === 'session/projection' && f.key === 'imageLimits')).toBe(false)
  })

  it('leaves the imageLimits key absent while no attachment service is composed', async () => {
    const { ctx, session } = await harness(true)
    seedMessages(session, 1)
    const response = await api(ctx).sessions.history(request({ sessionId: session.id }))
    if (!response.result.ok) throw new Error('history failed')
    expect(response.result.value.projections).toBeDefined()
    expect('imageLimits' in (response.result.value.projections?.values ?? {})).toBe(false)
  })

  it('never carries the block on loadOlder pages (beforeSeq present)', async () => {
    const { ctx, session } = await harness(true)
    ctx.sessionProjections.register(lastUserUnit())
    seedMessages(session, 5)
    const older = await api(ctx).sessions.history(request({ sessionId: session.id, beforeSeq: 3, maxMessages: 2 }))
    expect(older.result.ok).toBe(true)
    if (!older.result.ok) throw new Error('unreachable')
    expect('projections' in older.result.value).toBe(false)
  })

  it('serves no block when the composition has no projection registry', async () => {
    const { ctx, session } = await harness(false)
    seedMessages(session, 2)
    const response = await api(ctx).sessions.history(request({ sessionId: session.id }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect('projections' in response.result.value).toBe(false)
  })

  it('drops a disposed registration from subsequent tail pages (empty block, key absent)', async () => {
    const { ctx, session } = await harness(true)
    const dispose = ctx.sessionProjections.register(lastUserUnit())
    seedMessages(session, 1)
    const proxy = api(ctx)
    const before = await proxy.sessions.history(request({ sessionId: session.id }))
    if (!before.result.ok) throw new Error('unreachable')
    expect(before.result.value.projections?.values['test/last-user']).toEqual({ text: 'm0' })

    dispose()
    const after = await proxy.sessions.history(request({ sessionId: session.id }))
    if (!after.result.ok) throw new Error('unreachable')
    // The registry stays mounted; only the disposed key leaves while the
    // gateway-owned Session-list unit remains.
    expect(after.result.value.projections?.asOfSeq).toBe(session.seq - 1)
    expect('test/last-user' in (after.result.value.projections?.values ?? {})).toBe(false)
    expect(after.result.value.projections?.values.sessionListMetadata).toEqual({
      blank: true,
      lastPromptAt: session.events.at(-1)?.time,
    })
  })

  it('removes the gateway-owned Session-list unit when the gateway fiber unloads', async () => {
    const { ctx, session } = await harness(true)
    expect('sessionListMetadata' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    const fiber = ctx.plugin(Object.assign((gatewayCtx: Context) => {
      createApiProxy(gatewayCtx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    }, { inject: ['sessions', 'agents', 'userQuestions', 'sessionProjections'] }))
    await fiber.await()
    await vi.waitFor(() => {
      expect(ctx.sessionProjections.snapshot(session).values.sessionListMetadata)
        .toEqual({ blank: true, lastPromptAt: null })
    })
    await fiber.dispose()
    expect('sessionListMetadata' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})

describe('session.list projections column', () => {
  it('serves attached rows from the live registry cut, watermarked for client seeding', async () => {
    const { ctx, session } = await harness(true)
    ctx.sessionProjections.register(lastUserUnit())
    const gateway = api(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    session.append('turn/start', { turn: 1 })
    seedMessages(session, 1)
    const response = await gateway.sessions.list(request({}))
    if (!response.result.ok) throw new Error('unreachable')
    const row = response.result.value.items.find(item => item.sessionId === session.id)
    expect(row?.projections?.values['test/last-user']).toEqual({ text: 'm0' })
    expect(row?.projections?.values.sessionListMetadata).toEqual({
      blank: false,
      lastPromptAt: session.events.at(-1)?.time,
    })
    expect(row?.projections?.asOfSeq).toBe(session.seq - 1)
  })

  it('omits the column entirely when no registry is mounted', async () => {
    const { ctx, session } = await harness(false)
    seedMessages(session, 1)
    const response = await api(ctx).sessions.list(request({}))
    if (!response.result.ok) throw new Error('unreachable')
    const row = response.result.value.items.find(item => item.sessionId === session.id)
    expect(row).toBeDefined()
    expect(row !== undefined && 'projections' in row).toBe(false)
  })

  it('serves cold rows from the persisted projection cache with zero log loads', async () => {
    const { ctx } = await harness(true)
    const coldId = SessionId('session-cold-listing')
    const load = () => { throw new Error('list must not load event logs') }
    ctx.provide('sessionPersistence', {
      list: async () => [{ version: 0, id: coldId, createdAt: 5, cwd: '/tmp' }],
      locate: () => undefined,
      load,
      inspect: load,
      readFrom: load,
    } as never)
    ctx.provide('sessionProjectionCache', {
      // The carrier hands the listed header through as the identity witness.
      cachedSnapshot: (meta: { id: unknown; createdAt: number }) =>
        (meta.id === coldId && meta.createdAt === 5
          ? { asOfSeq: 7, values: { 'test/last-user': { text: 'cached' } } }
          : undefined),
    } as never)
    const response = await api(ctx).sessions.list(request({}))
    if (!response.result.ok) throw new Error('unreachable')
    const row = response.result.value.items.find(item => item.sessionId === coldId)
    expect(row?.running).toBe(false)
    expect(row?.projections).toEqual({ asOfSeq: 7, values: { 'test/last-user': { text: 'cached' } } })
  })

  it('cold rows without a cache plugin (or without a stored row) just lack the column', async () => {
    const { ctx } = await harness(true)
    const coldId = SessionId('session-cold-uncached')
    ctx.provide('sessionPersistence', {
      list: async () => [{ version: 0, id: coldId, createdAt: 5, cwd: '/tmp' }],
      locate: () => undefined,
    } as never)
    const response = await api(ctx).sessions.list(request({}))
    if (!response.result.ok) throw new Error('unreachable')
    const row = response.result.value.items.find(item => item.sessionId === coldId)
    expect(row).toBeDefined()
    expect(row !== undefined && 'projections' in row).toBe(false)
  })

  it('a throwing column read degrades that row, never the listing', async () => {
    const { ctx, session } = await harness(true)
    ctx.sessionProjections.register({
      ...lastUserUnit(),
      view: () => { throw new Error('unit exploded') },
    })
    seedMessages(session, 1)
    const response = await api(ctx).sessions.list(request({}))
    if (!response.result.ok) throw new Error('unreachable')
    const row = response.result.value.items.find(item => item.sessionId === session.id)
    expect(row).toBeDefined()
    expect(row !== undefined && 'projections' in row).toBe(false)
  })
})

describe('session/projection push frame', () => {
  /** Drain frames until `count` session/projection frames arrived. */
  async function collect(iterable: AsyncIterable<RpcRequest<MuxFrame>>, count: number, abort: AbortController): Promise<MuxFrame[]> {
    const frames: MuxFrame[] = []
    for await (const envelope of iterable) {
      frames.push(envelope.payload)
      if (frames.filter(f => f.type === 'session/projection').length >= count) abort.abort()
    }
    return frames
  }

  it('broadcasts a frame per changed unit with the causing seq, and none for same-reference applies', async () => {
    const { ctx, session } = await harness(true)
    ctx.sessionProjections.register(lastUserUnit())
    const proxy = api(ctx)
    // The gateway's onChanged subscription lives in an inject child whose
    // fiber activates asynchronously; yield until it lands before appending.
    await new Promise(resolve => setTimeout(resolve, 0))
    const abort = new AbortController()
    const stream = proxy.events.mux({ rpcId: RpcId('t-proj-mux'), payload: {} }, abort.signal)
    const collected = collect(stream, 5, abort)

    const now = vi.spyOn(Date, 'now').mockReturnValue(100)
    seedMessages(session, 1)
    now.mockReturnValue(200)
    session.append('turn/start', { turn: 1 })
    now.mockReturnValue(300)
    seedMessages(session, 1)
    now.mockRestore()

    const frames = await collected
    const pushes = frames.filter(
      (f): f is Extract<MuxFrame, { type: 'session/projection' }> =>
        f.type === 'session/projection' && f.key === 'test/last-user',
    )
    expect(pushes).toEqual([
      { type: 'session/projection', sessionId: session.id, key: 'test/last-user', value: { text: 'm0' }, seq: 0 },
      { type: 'session/projection', sessionId: session.id, key: 'test/last-user', value: { text: 'm0' }, seq: 2 },
    ])
    expect(frames.filter(
      (f): f is Extract<MuxFrame, { type: 'session/projection' }> =>
        f.type === 'session/projection' && f.key === 'sessionListMetadata',
    )).toEqual([
      { type: 'session/projection', sessionId: session.id, key: 'sessionListMetadata', value: { blank: true, lastPromptAt: 100 }, seq: 0 },
      { type: 'session/projection', sessionId: session.id, key: 'sessionListMetadata', value: { blank: false, lastPromptAt: 100 }, seq: 1 },
      { type: 'session/projection', sessionId: session.id, key: 'sessionListMetadata', value: { blank: false, lastPromptAt: 300 }, seq: 2 },
    ])
    // Frame seq aligns with the tail block's asOfSeq vocabulary (higher-seq-wins compatible).
    const tail = await proxy.sessions.history(request({ sessionId: session.id }))
    if (!tail.result.ok) throw new Error('unreachable')
    expect(tail.result.value.projections?.asOfSeq).toBe(pushes.at(-1)?.seq)
  })

  it('emits no projection frames when the composition has no registry', async () => {
    const { ctx, session } = await harness(false)
    const proxy = api(ctx)
    const abort = new AbortController()
    const stream = proxy.events.mux({ rpcId: RpcId('t-noproj-mux'), payload: {} }, abort.signal)
    const frames: MuxFrame[] = []
    const drained = (async () => {
      for await (const envelope of stream) {
        frames.push(envelope.payload)
        if (frames.filter(f => f.type === 'session/event').length >= 2) abort.abort()
      }
    })()
    seedMessages(session, 2)
    await drained
    expect(frames.some(f => f.type === 'session/projection')).toBe(false)
  })
})
