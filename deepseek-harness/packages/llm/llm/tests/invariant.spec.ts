import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as LlmInvariant from '@deepseek-ai/dsh-llm/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(LlmInvariant)
  return ctx
}

const options: GenerateOptions = { provider: 'mock', model: 'mock', messages: [] }

async function* source(chunks: readonly StreamChunk[]): AsyncIterable<StreamChunk> {
  yield* chunks
}

async function consume(ctx: Context, chunks: readonly StreamChunk[]): Promise<StreamChunk[]> {
  const stream = ctx.waterfall(ctx as never, 'llm/stream', options, () => source(chunks))
  const consumed: StreamChunk[] = []
  for await (const chunk of stream) consumed.push(chunk)
  return consumed
}

const finish: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }

describe('LLM stream invariants', () => {
  it('accepts a complete interleaved stream grammar', async () => {
    const ctx = await setup()
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'a' },
      { type: 'block-start', index: 1, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 1, text: 'b' },
      { type: 'block-end', index: 1, block: { type: 'reasoning', text: 'b' } },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'a' } },
      { type: 'block-start', index: 2, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 2, id: CallId('c1'), name: 'echo', argumentsDelta: '{}' },
      { type: 'block-end', index: 2, block: { type: 'tool-call', id: CallId('c1'), name: 'echo', arguments: '{}' } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      finish,
    ]
    await expect(consume(ctx, chunks)).resolves.toEqual(chunks)
  })

  it.each([
    [[{ type: 'block-start', index: -1, blockType: 'text' }, finish], /non-negative safe integer/],
    [[
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-start', index: 0, blockType: 'text' },
    ], /repeated block-start/],
    [[{ type: 'text-delta', index: 0, text: 'x' }], /requires an open text block/],
    [[
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'text-delta', index: 0, text: 'x' },
    ], /got reasoning/],
    [[{ type: 'block-end', index: 0, block: { type: 'text', text: '' } }], /has no open block/],
    [[
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '' } },
    ], /closes reasoning, expected text/],
    [[
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    ], /usage more than once/],
    [[{ type: 'block-start', index: 0, blockType: 'text' }, finish], /finished with 1 open block/],
    [[finish, { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }], /usage after terminal finish/],
    [[], /ended without a terminal finish/],
  ] as Array<[StreamChunk[], RegExp]>)('rejects malformed stream %#', async (chunks, message) => {
    const ctx = await setup()
    await expect(consume(ctx, chunks)).rejects.toThrow(message)
  })

  it('preserves provider exceptions without inventing a missing-finish failure', async () => {
    const ctx = await setup()
    const stream = ctx.waterfall(ctx as never, 'llm/stream', options, async function* () {
      throw new Error('provider failed')
    })
    await expect((async () => {
      for await (const _chunk of stream) { /* consume */ }
    })()).rejects.toThrow('provider failed')
  })
})

describe('adapters-updated invariants', () => {
  class NoopAdapter extends LlmAdapter {

    async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
      throw new Error('not exercised')
    }
  }

  it('accepts a coherent registry at every topology notification', async () => {
    const ctx = await setup()
    await ctx.plugin(LlmRuntime)
    const dispose = ctx.llm.registerAdapter(['coherent'], new NoopAdapter())
    ctx.llm.registerConfigurableProviders([
      { provider: 'dormant', displayName: 'Dormant', settingsNs: 'ns', settingsPath: [] },
    ])
    dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('skips the check when the service store has no llm entry', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('llm/adapters-updated') }).not.toThrow()
  })

  it('reports a notification whose registry cannot be re-read', async () => {
    class BrokenLlm extends LlmRuntime {
      override providerRetryPolicy(_provider: string): never {
        throw new Error('registration vanished')
      }
    }
    const ctx = await setup()
    await ctx.plugin(BrokenLlm)
    expect(() => ctx.llm.registerAdapter(['ghost'], new NoopAdapter()))
      .toThrow(/no readable registration/)
  })
})
