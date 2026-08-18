import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { type Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime, { type SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as scripted from './scripted-provider.ts'

/** A minimal parent; the scripted provider only reads its id. */
function fakeParent(id = 'parent-1'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

function baseRequest(over: Partial<SubagentStartRequest> = {}): SubagentStartRequest {
  return {
    prompt: [{ type: 'text', text: 'task' }],
    parent: fakeParent(),
    signal: new AbortController().signal,
    ...over,
  }
}

async function mount(config: Partial<scripted.Config> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  await scripted.mountScriptedProvider(ctx, { name: 'mock', ...config })
  return ctx
}

describe('scripted subagent provider fixture', () => {
  it('registers through the real service and returns the scripted reply', async () => {
    const ctx = await mount({ reply: 'hello from fixture' })
    expect(ctx.subagents.list()).toEqual(['mock'])

    const run = await ctx.subagents.start('mock', baseRequest())
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'hello from fixture' }],
      structured: undefined,
      stopReason: 'completed',
    })
    await run.dispose()
  })

  it('registers under a configurable name', async () => {
    const ctx = await mount({ name: 'spawn' })
    expect(ctx.subagents.list()).toEqual(['spawn'])
  })

  it('returns configured and default structured results', async () => {
    const configured = await mount({ reply: 'r', structured: { answer: 42 } })
    const schema = { type: 'object' as const, properties: { answer: { type: 'number' as const } } }
    const configuredRun = await configured.subagents.start('mock', baseRequest({ outputSchema: schema }))
    await expect(configuredRun.result).resolves.toMatchObject({ structured: { answer: 42 } })

    const fallback = await mount({ reply: 'fallback reply' })
    const fallbackRun = await fallback.subagents.start('mock', baseRequest({ outputSchema: schema }))
    await expect(fallbackRun.result).resolves.toMatchObject({ structured: { reply: 'fallback reply' } })
  })

  it('omits structured output when no schema is requested', async () => {
    const ctx = await mount({ capabilities: { outputSchema: false } })
    const run = await ctx.subagents.start('mock', baseRequest())
    expect(await run.result).not.toHaveProperty('structured')
  })

  it('honors configured and cancellation stop reasons', async () => {
    const refused = await mount({ stopReason: 'refusal' })
    const refusedRun = await refused.subagents.start('mock', baseRequest())
    await expect(refusedRun.result).resolves.toMatchObject({ stopReason: 'refusal' })

    const cancelled = await mount()
    const controller = new AbortController()
    const cancelledRun = await cancelled.subagents.start('mock', baseRequest({ signal: controller.signal }))
    controller.abort()
    await expect(cancelledRun.result).resolves.toMatchObject({ stopReason: 'aborted' })
  })

  it('rejects cancellation before or during asynchronous publication', async () => {
    const ctx = await mount()
    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(ctx.subagents.start('mock', baseRequest({ signal: alreadyAborted.signal })))
      .rejects.toThrow('scripted subagent start aborted before publication')

    const handoff = new AbortController()
    const pending = ctx.subagents.start('mock', baseRequest({ signal: handoff.signal }))
    handoff.abort()
    await expect(pending).rejects.toThrow('scripted subagent start aborted before publication')
  })

  it('unregisters with its owning fixture fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    const fiber = await scripted.mountScriptedProvider(ctx, { name: 'mock' })
    expect(ctx.subagents.list()).toEqual(['mock'])
    await fiber.dispose()
    expect(ctx.subagents.list()).toEqual([])
  })
})
