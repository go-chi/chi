import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, CallId, ReasoningEffortId , createMessage } from '@deepseek-ai/dsh-llm'
import type { Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import type { Config } from '@deepseek-ai/dsh-llm-deepseek'
import { assemble, type AssembledResult } from './assemble.ts'

/**
 * Real-API e2e for the direct-fetch adapter: V4 Flash + V4 Pro across
 * thinking modes and all official effort levels. Key-gated — skips
 * entirely without $DEEPSEEK_API_KEY (see vitest.e2e.config.ts).
 */

const FLASH = 'deepseek-v4-flash'
const PRO = 'deepseek-v4-pro'
const contexts: Context[] = []
let identityHome: string

beforeEach(async () => {
  identityHome = await mkdtemp(join(tmpdir(), 'dsh-e2e-user-id-'))
  vi.stubEnv('DSH_HOME', identityHome)
})

async function harness(_model: string, config: Partial<Config> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmDeepSeek, config)
  return ctx
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllEnvs()
  await rm(identityHome, { recursive: true, force: true })
})

function ask(text: string): Message[] {
  return [createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'test' },
  })]
}

function textOf(result: AssembledResult): string {
  return result.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

const weatherTool: ToolSchema = {
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
}

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('llm-deepseek e2e (real API)', () => {
  it('serves a real request with the key held only by a credentials-local document', async () => {
    const key = process.env.DEEPSEEK_API_KEY
    if (key === undefined) throw new Error('e2e ran without DEEPSEEK_API_KEY')
    const dir = await mkdtemp(join(tmpdir(), 'dsh-e2e-credentials-'))
    try {
      // JSON.stringify quotes the value: YAML is a JSON superset, so a real
      // key survives whatever characters it happens to carry.
      await writeFile(join(dir, '.credentials.yaml'), `DEEPSEEK_API_KEY: ${JSON.stringify(key)}\n`, { mode: 0o600 })
      // Scrub the ambient variable so only the credential seam can supply the
      // key: this request proves the per-request resolution path end to end.
      vi.stubEnv('DEEPSEEK_API_KEY', '')
      const ctx = new Context()
      contexts.push(ctx)
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(LlmDeepSeek, {})

      const result = await assemble(ctx, {
        model: FLASH,
        messages: ask('Reply with exactly the word: pong'),
        maxTokens: 50,
      })
      expect(result.finish.kind).toBe('stop')
      expect(textOf(result).toLowerCase()).toContain('pong')
    } finally {
      vi.unstubAllEnvs()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('flash dynamically switches from off to low', async () => {
    const ctx = await harness(FLASH, { reasoningEffort: 'off' })
    const withoutThinking = await assemble(ctx,{
      model: FLASH,
      messages: ask('Reply with exactly the word: pong'),
      maxTokens: 50,
    })
    expect(withoutThinking.finish.kind).toBe('stop')
    expect(textOf(withoutThinking).toLowerCase()).toContain('pong')
    expect(withoutThinking.message.content.some(block => block.type === 'reasoning')).toBe(false)
    expect(withoutThinking.usage?.inputTokens).toBeGreaterThan(0)
    expect(withoutThinking.usage?.outputTokens).toBeGreaterThan(0)

    const withThinking = await assemble(ctx,{
      model: FLASH,
      reasoningEffort: ReasoningEffortId('low'),
      messages: ask('Which is larger, 9.11 or 9.8? Answer with just the number.'),
      maxTokens: 2000,
    })
    expect(withThinking.finish.kind).toBe('stop')
    expect(withThinking.message.content.some(block => block.type === 'reasoning')).toBe(true)
    expect(textOf(withThinking)).toContain('9.8')
    expect(withThinking.usage?.reasoningTokens).toBeGreaterThan(0)
  })

  it.each(['high', 'max'] as const)(
    'pro + thinking enabled (effort %s): tool-call round trip with reasoning passback',
    async (effort) => {
      const ctx = await harness(PRO, { thinking: 'enabled' })

      // Turn 1: the model must call the tool (and think before it).
      const first = await assemble(ctx,{
        model: PRO,
        reasoningEffort: ReasoningEffortId(effort),
        messages: ask('What is the weather in Paris right now? Use the get_weather tool.'),
        tools: [weatherTool],
        maxTokens: 2000,
      })
      expect(first.finish.kind).toBe('tool-calls')
      const call = first.message.content.find(block => block.type === 'tool-call')
      expect(call).toBeDefined()
      expect(call!.name).toBe('get_weather')
      expect(JSON.parse(call!.arguments)).toMatchObject({ city: expect.stringMatching(/paris/i) as string })

      // Turn 2: send the tool result back WITH the assistant's reasoning
      // block in history (the official thinking+tools passback rule).
      const second = await assemble(ctx,{
        model: PRO,
        reasoningEffort: ReasoningEffortId(effort),
        messages: [
          ...ask('What is the weather in Paris right now? Use the get_weather tool.'),
          createMessage({
            role: 'assistant', content: first.message.content,
            source: { kind: 'plugin', plugin: 'test' },
          }),
          createUserMessage({
            content: [{
              type: 'tool-result',
              toolCallId: CallId(call!.id),
              content: [{ type: 'text', text: 'Sunny, 22°C' }],
            }],
            source: { kind: 'plugin', plugin: 'test' },
          }),
        ],
        tools: [weatherTool],
        maxTokens: 2000,
      })
      expect(second.finish.kind).toBe('stop')
      expect(textOf(second).toLowerCase()).toMatch(/sunny|22/)
    },
  )

  it('pro + thinking disabled: plain generation without reasoning blocks', async () => {
    const ctx = await harness(PRO, { thinking: 'disabled' })
    const result = await assemble(ctx,{
      model: PRO,
      messages: ask('Reply with exactly the word: pong'),
      maxTokens: 50,
    })
    expect(result.finish.kind).toBe('stop')
    expect(result.message.content.some(block => block.type === 'reasoning')).toBe(false)
  })

  it('streams raw chunks in protocol order', async () => {
    const ctx = await harness(FLASH, { thinking: 'disabled' })
    const kinds: string[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'deepseek-official',
      model: FLASH,
      messages: ask('Count from 1 to 5, digits only.'),
      maxTokens: 50,
    })) {
      kinds.push(chunk.type)
    }
    expect(kinds[0]).toBe('block-start')
    expect(kinds.at(-1)).toBe('finish')
    expect(kinds.filter(kind => kind === 'finish')).toHaveLength(1)
    // usage precedes finish (deferred-emit contract)
    expect(kinds.indexOf('usage')).toBeLessThan(kinds.indexOf('finish'))
  })
})
