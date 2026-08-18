/**
 * Approval pending registry over the proxy: an ask through `ctx.approval`
 * becomes an answerable `approval/requested` mux frame (stable rpcId, replayed
 * verbatim on a later mux open), `respond` routes by the echoed rpcId and
 * validates the audit correlation, and the ask's abort signal withdraws the
 * question with a broadcast `cancelled`.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type { ApiProxy, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId as mintRpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

async function harness(): Promise<{ ctx: Context; api: ApiProxy }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ApprovalService)
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
  return { ctx, api }
}

/** A minimal agent stand-in inside an open turn (the service only reaches `.session`). */
function agentOf(ctx: Context): Agent {
  const session = ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  return { session } as unknown as Agent
}

/** Open a mux stream and capture frames into an array (returns an on-demand waiter). */
function openMux(api: ApiProxy, abort: AbortController): { frames: MuxFrame[]; envelopes: RpcRequest<MuxFrame>[]; waitFor(type: MuxFrame['type']): Promise<MuxFrame> } {
  const frames: MuxFrame[] = []
  const envelopes: RpcRequest<MuxFrame>[] = []
  const waiters: { type: MuxFrame['type']; resolve: (frame: MuxFrame) => void }[] = []
  void (async () => {
    for await (const envelope of api.events.mux({ rpcId: mintRpcId('t-mux'), payload: {} }, abort.signal)) {
      frames.push(envelope.payload)
      envelopes.push(envelope)
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        const waiter = waiters[i] as (typeof waiters)[number]
        if (waiter.type === envelope.payload.type) {
          waiters.splice(i, 1)
          waiter.resolve(envelope.payload)
        }
      }
    }
  })()
  return {
    frames,
    envelopes,
    waitFor: (type) => {
      const found = frames.find(frame => frame.type === type)
      if (found !== undefined) return Promise.resolve(found)
      return new Promise((resolve) => { waiters.push({ type, resolve }) })
    },
  }
}

function requestedOf(frame: MuxFrame): Extract<MuxFrame, { type: 'approval/requested' }> {
  if (frame.type !== 'approval/requested') throw new Error(`expected approval/requested, got ${frame.type}`)
  return frame
}

/** Wait until the stream delivered `count` frames of `type` (bounded poll; waitFor only covers the first). */
async function waitForCount(mux: { frames: MuxFrame[] }, type: MuxFrame['type'], count: number): Promise<void> {
  for (let i = 0; i < 200 && mux.frames.filter(frame => frame.type === type).length < count; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(mux.frames.filter(frame => frame.type === type).length).toBeGreaterThanOrEqual(count)
}

function answer(rpcId: RpcId, sessionId: unknown, approvalId: ApprovalRequestId, outcome: 'allowed-once' | 'rejected'): Parameters<ApiProxy['respond']>[0] {
  return { type: 'client-response', rpcId, result: { ok: true, value: { sessionId, approvalId, outcome } } }
}

describe('approval pending registry', () => {
  it('round-trips ask → requested frame → respond → outcome + resolved broadcast', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const agent = agentOf(ctx)

    const asked = ctx.approval.request({ agent, toolName: 'bash', reason: 'sandbox escalation' })
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    expect(requested).toMatchObject({ toolName: 'bash', reason: 'sandbox escalation', sessionId: agent.session.id })

    const envelope = mux.envelopes.find(e => e.payload.type === 'approval/requested') as RpcRequest<MuxFrame>
    const receipt = await api.respond(answer(envelope.rpcId, requested.sessionId, requested.approvalId, 'allowed-once'))
    expect(receipt).toEqual({ accepted: true })
    await expect(asked).resolves.toBe('allowed-once')

    const resolved = await mux.waitFor('approval/resolved')
    expect(resolved).toMatchObject({ approvalId: requested.approvalId, outcome: 'allowed-once' })

    // The question settled: a duplicate answer is late, not re-decidable.
    const dup = await api.respond(answer(envelope.rpcId, requested.sessionId, requested.approvalId, 'rejected'))
    expect(dup).toEqual({ accepted: false, reason: 'not-pending' })
    abort.abort()
  })

  it('replays a still-pending requested frame (same rpcId) on a later mux open', async () => {
    const { ctx, api } = await harness()
    const first = new AbortController()
    const firstMux = openMux(api, first)
    const agent = agentOf(ctx)
    const asked = ctx.approval.request({ agent, toolName: 'write' })
    const requested = requestedOf(await firstMux.waitFor('approval/requested'))
    const firstEnvelope = firstMux.envelopes.find(e => e.payload.type === 'approval/requested') as RpcRequest<MuxFrame>
    first.abort()

    // A fresh subscriber (refresh recovery) sees the same stable rpcId.
    const second = new AbortController()
    const secondMux = openMux(api, second)
    const replayed = requestedOf(await secondMux.waitFor('approval/requested'))
    const secondEnvelope = secondMux.envelopes.find(e => e.payload.type === 'approval/requested') as RpcRequest<MuxFrame>
    expect(secondEnvelope.rpcId).toBe(firstEnvelope.rpcId)
    expect(replayed.approvalId).toBe(requested.approvalId)

    const receipt = await api.respond(answer(secondEnvelope.rpcId, replayed.sessionId, replayed.approvalId, 'rejected'))
    expect(receipt).toEqual({ accepted: true })
    await expect(asked).resolves.toBe('rejected')
    second.abort()
  })

  it('rejects malformed and mismatched answers as bad-response, unknown ids as not-pending', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const agent = agentOf(ctx)
    void ctx.approval.request({ agent, toolName: 'bash' })
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    const envelope = mux.envelopes.find(e => e.payload.type === 'approval/requested') as RpcRequest<MuxFrame>

    // Unknown rpcId: not routed to any pending entry.
    expect(await api.respond(answer(mintRpcId('ghost'), requested.sessionId, requested.approvalId, 'rejected')))
      .toEqual({ accepted: false, reason: 'not-pending' })
    // Error-branch result: the client can only answer with a value.
    expect(await api.respond({ type: 'client-response', rpcId: envelope.rpcId, result: { ok: false, error: { code: 'internal', message: 'x', details: {} } } }))
      .toEqual({ accepted: false, reason: 'bad-response' })
    // Wrong audit correlation: the rpcId routed, but the payload disagrees.
    expect(await api.respond(answer(envelope.rpcId, requested.sessionId, 'other-approval' as ApprovalRequestId, 'rejected')))
      .toEqual({ accepted: false, reason: 'bad-response' })
    // Malformed payload shape.
    expect(await api.respond({ type: 'client-response', rpcId: envelope.rpcId, result: { ok: true, value: { nonsense: 1 } } }))
      .toEqual({ accepted: false, reason: 'bad-response' })
    abort.abort()
  })

  it('withdraws the question on the ask signal: cancelled outcome, resolved broadcast, late answer not-pending', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const agent = agentOf(ctx)
    const cancel = new AbortController()
    const asked = ctx.approval.request({ agent, toolName: 'bash', signal: cancel.signal })
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    const envelope = mux.envelopes.find(e => e.payload.type === 'approval/requested') as RpcRequest<MuxFrame>

    cancel.abort()
    await expect(asked).resolves.toBe('cancelled')
    const resolved = await mux.waitFor('approval/resolved')
    expect(resolved).toMatchObject({ approvalId: requested.approvalId, outcome: 'cancelled' })
    expect(await api.respond(answer(envelope.rpcId, requested.sessionId, requested.approvalId, 'allowed-once')))
      .toEqual({ accepted: false, reason: 'not-pending' })
    abort.abort()
  })

  it('an ask whose signal aborted before dispatch settles cancelled without publishing', async () => {
    // The service checks the signal, then dispatch rides a microtask: an
    // abort in that window must not register a dead listener and strand the
    // entry (zombie frame on every replay). Drive the waterfall directly
    // with a pre-aborted signal to hit the answerer's register-path guard.
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('approval/asked', { id: 'pre-aborted' as ApprovalRequestId, toolName: 'bash' })
    const agent = { session } as unknown as Agent
    const cancelled = new AbortController()
    cancelled.abort()
    const outcome = await ctx.waterfall(
      'approval/request',
      { agent, toolName: 'bash', signal: cancelled.signal },
      () => Promise.resolve('unavailable' as const),
    )
    expect(outcome).toBe('cancelled')
    // Nothing was published: a fresh mux open replays no approval frame.
    const abort2 = new AbortController()
    const mux2 = openMux(api, abort2)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mux2.envelopes.some(e => e.payload.type === 'approval/requested')).toBe(false)
    abort2.abort()
    abort.abort()
    void mux
  })

  it('gateway teardown settles pending approvals as cancelled (question-provider parity)', async () => {
    // Mount the proxy on its own fiber so disposal exercises the teardown
    // effect while an ask is still pending.
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ApprovalService)
    let api!: ApiProxy
    const fiber = ctx.plugin(Object.assign((fiberCtx: Context) => {
      api = createApiProxy(fiberCtx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    }, { inject: ['sessions', 'agents', 'userQuestions', 'approval'] }))
    await fiber.await()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const asked = ctx.approval.request({ agent: agentOf(ctx), toolName: 'bash' })
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    await fiber.dispose()
    await expect(asked).resolves.toBe('cancelled')
    const resolved = await mux.waitFor('approval/resolved')
    expect(resolved).toMatchObject({ approvalId: requested.approvalId, outcome: 'cancelled' })
    abort.abort()
  })

  it('carries callId on the frame and ignores a late abort after the answer settled', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const agent = agentOf(ctx)
    const cancel = new AbortController()
    const asked = ctx.approval.request({ agent, toolName: 'bash', callId: 'call-9' as never, signal: cancel.signal })
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    expect(requested.callId).toBe('call-9')
    const envelope = mux.envelopes.find(e => e.payload.type === 'approval/requested') as RpcRequest<MuxFrame>
    expect(await api.respond(answer(envelope.rpcId, requested.sessionId, requested.approvalId, 'allowed-once')))
      .toEqual({ accepted: true })
    await expect(asked).resolves.toBe('allowed-once')
    // Late abort: the pending entry is gone; settle's delete-guard returns.
    cancel.abort()
    expect(mux.frames.filter(f => f.type === 'approval/resolved')).toHaveLength(1)
    abort.abort()
  })

  it('pairs parallel asks by callId: each requested frame carries its own audit id', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const agent = agentOf(ctx)
    // Both asks append their approval/asked audit events before either
    // answerer's microtask dispatch runs — the parallel tool-call window.
    const askA = ctx.approval.request({ agent, toolName: 'bash', callId: 'call-a' as never })
    const askB = ctx.approval.request({ agent, toolName: 'bash', callId: 'call-b' as never })
    await waitForCount(mux, 'approval/requested', 2)
    const frames = mux.envelopes.filter(e => e.payload.type === 'approval/requested')
    const frameA = frames.find(e => requestedOf(e.payload).callId === 'call-a') as RpcRequest<MuxFrame>
    const frameB = frames.find(e => requestedOf(e.payload).callId === 'call-b') as RpcRequest<MuxFrame>
    // Each frame claimed the asked event with its own callId, not merely the newest.
    const askedIdByCall = new Map(agent.session.events
      .filter(event => event.type === 'approval/asked')
      .map(event => [String(event.data.callId), event.data.id]))
    expect(requestedOf(frameA.payload).approvalId).toBe(askedIdByCall.get('call-a'))
    expect(requestedOf(frameB.payload).approvalId).toBe(askedIdByCall.get('call-b'))
    // Answers route back to the right ask through the pairing.
    expect(await api.respond(answer(frameB.rpcId, agent.session.id, requestedOf(frameB.payload).approvalId, 'rejected')))
      .toEqual({ accepted: true })
    expect(await api.respond(answer(frameA.rpcId, agent.session.id, requestedOf(frameA.payload).approvalId, 'allowed-once')))
      .toEqual({ accepted: true })
    await expect(askA).resolves.toBe('allowed-once')
    await expect(askB).resolves.toBe('rejected')
    abort.abort()
  })

  it('gives parallel callId-less asks distinct audit ids (claimed-entry skip); both stay answerable', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const agent = agentOf(ctx)
    const askA = ctx.approval.request({ agent, toolName: 'alpha' })
    const askB = ctx.approval.request({ agent, toolName: 'beta' })
    await waitForCount(mux, 'approval/requested', 2)
    const frames = mux.envelopes.filter(e => e.payload.type === 'approval/requested')
    const frameA = frames.find(e => requestedOf(e.payload).toolName === 'alpha') as RpcRequest<MuxFrame>
    const frameB = frames.find(e => requestedOf(e.payload).toolName === 'beta') as RpcRequest<MuxFrame>
    // Without a callId the pairing is heuristic, but never shared: the second
    // dispatch skips the id the first pending entry already claimed.
    expect(requestedOf(frameA.payload).approvalId).not.toBe(requestedOf(frameB.payload).approvalId)
    expect(await api.respond(answer(frameA.rpcId, agent.session.id, requestedOf(frameA.payload).approvalId, 'allowed-once')))
      .toEqual({ accepted: true })
    expect(await api.respond(answer(frameB.rpcId, agent.session.id, requestedOf(frameB.payload).approvalId, 'rejected')))
      .toEqual({ accepted: true })
    await expect(askA).resolves.toBe('allowed-once')
    await expect(askB).resolves.toBe('rejected')
    abort.abort()
  })

  it('delegates a dispatch whose only asked candidate is already decided (stale re-dispatch)', async () => {
    const { ctx, api } = await harness()
    void api // the answerer is registered; the fake below bypasses the service
    // Bypass ApprovalService: a log whose sole asked event already has its
    // decided partner must not be re-claimed — the answerer delegates.
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('approval/asked', { id: 'stale-ask' as ApprovalRequestId, toolName: 'bash' })
    session.append('approval/decided', { id: 'stale-ask' as ApprovalRequestId, outcome: 'rejected' })
    const agent = { session } as unknown as Agent
    const outcome = await ctx.waterfall('approval/request', { agent, toolName: 'bash' }, () => Promise.resolve('unavailable' as const))
    expect(outcome).toBe('unavailable')
  })

  it('delegates an ask whose session log carries no asked audit event (foreign channel)', async () => {
    const { ctx, api } = await harness()
    void api // the answerer is registered; the fake below bypasses the audit path
    // Bypass ApprovalService: dispatch the waterfall directly with a session
    // that has no approval/asked event — the proxy answerer must call next().
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    const agent = { session } as unknown as Agent
    const outcome = await ctx.waterfall('approval/request', { agent, toolName: 'x' }, () => Promise.resolve('unavailable' as const))
    expect(outcome).toBe('unavailable')
  })
})
