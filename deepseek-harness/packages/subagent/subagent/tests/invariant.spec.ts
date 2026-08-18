import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import type {
  SubagentProvider,
  SubagentRunEndInfo,
  SubagentRunInfo,
} from '@deepseek-ai/dsh-subagent'
import * as SubagentInvariant from '@deepseek-ai/dsh-subagent/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SubagentInvariant)
  return ctx
}

const provider = (name: string): SubagentProvider => ({
  name,
  capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
  inheritsParentContext: false,
  start: async () => { throw new Error('not used') },
})

const start = (overrides: Partial<SubagentRunInfo> = {}): SubagentRunInfo => ({
  runId: SubagentRunId('run-1'),
  provider: 'mock',
  id: SessionId('child-1'),
  local: false,
  ...overrides,
})

const end = (overrides: Partial<SubagentRunEndInfo> = {}): SubagentRunEndInfo => ({
  ...start(),
  stopReason: 'completed',
  ...overrides,
})

function emitRun(ctx: Context, name: 'subagent/start', info: SubagentRunInfo): void
function emitRun(ctx: Context, name: 'subagent/end', info: SubagentRunEndInfo): void
function emitRun(ctx: Context, name: 'subagent/start' | 'subagent/end', info: SubagentRunInfo | SubagentRunEndInfo): void {
  ctx.emit(scopeTarget(ctx.subagents, {}), name as 'subagent/start', info)
}

describe('subagent invariants', () => {
  it('accepts provider and run lifecycle pairs', async () => {
    const ctx = await setup()
    const mock = provider('mock')
    ctx.emit('subagent/provider-added', mock)
    emitRun(ctx, 'subagent/start', start())
    emitRun(ctx, 'subagent/end', end())
    ctx.emit('subagent/provider-removed', 'mock')
    ctx.emit('tools/change')
  })

  it('rejects malformed provider transitions', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('subagent/provider-added', provider('')) }).toThrow(/names must be non-empty/)
    const mock = provider('mock')
    ctx.emit('subagent/provider-added', mock)
    expect(() => { ctx.emit('subagent/provider-added', mock) }).toThrow(/repeated "mock"/)
    expect(() => { ctx.emit('subagent/provider-removed', 'missing') }).toThrow(/unknown provider/)
  })

  it('rejects malformed and unpaired run transitions', async () => {
    const ctx = await setup()
    expect(() => { emitRun(ctx, 'subagent/start', start({ provider: '' })) })
      .toThrow(/provider, runId, and child id must be non-empty/)
    expect(() => { emitRun(ctx, 'subagent/start', start({ runId: SubagentRunId('') })) })
      .toThrow(/provider, runId, and child id must be non-empty/)
    emitRun(ctx, 'subagent/start', start())
    expect(() => { emitRun(ctx, 'subagent/start', start()) }).toThrow(/repeated run id/)
    expect(() => { emitRun(ctx, 'subagent/end', end({ runId: SubagentRunId('missing') })) })
      .toThrow(/no matching subagent\/start/)
    expect(() => { emitRun(ctx, 'subagent/end', end({ id: SessionId('other') })) })
      .toThrow(/identity diverges/)
  })

  it('accepts the recorded provider name after registration ends', async () => {
    const ctx = await setup()
    const historical = provider('historical')
    ctx.emit('subagent/provider-added', historical)
    ctx.emit('subagent/provider-removed', historical.name)

    emitRun(ctx, 'subagent/start', start({ provider: historical.name }))
    emitRun(ctx, 'subagent/end', end({ provider: historical.name }))
  })
})
