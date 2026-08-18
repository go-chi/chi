import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ToolTasks from '@deepseek-ai/dsh-tool-jobs'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as mock from './scripted-provider.ts'
import * as tool from '../src/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

const testToolSignal = new AbortController().signal

/**
 * Drives the REAL plugin body: mounts `dsh-tool-subagent` on a real
 * `ToolRuntime` + `SubagentRuntime`, with a package-local scripted child
 * boundary, and invokes the registered `subagent` tool through
 * `ctx.tools.execute`. Everything downstream of the child boundary is the
 * shipping code path.
 */

/** A minimal parent Agent passed through to the provider request. */
function fakeAgent(id = 'parent-1'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

async function setup(toolConfig: tool.Config, mockConfig: Partial<mock.Config> = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  await mock.mountScriptedProvider(ctx, { name: 'mock', ...mockConfig })
  await ctx.plugin(tool, toolConfig)
  return ctx
}

let callCounter = 0
function callSubagent(ctx: Context, args: unknown, over: { agent?: Agent | undefined; signal?: AbortSignal } = {}) {
  // Distinguish "no override" (use a default agent) from an explicit
  // `{ agent: undefined }` (test the no-agent path). Under
  // exactOptionalPropertyTypes the key is omitted rather than set to undefined.
  const agent = 'agent' in over ? over.agent : fakeAgent()
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name: 'subagent',
    arguments: args,
    ...agent ? { agent } : {},
    ...over.signal ? { signal: over.signal } : {},
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('dsh-tool-subagent', () => {
  it('rejects continuable background policy when the provider cannot prepare continuable children', async () => {
    let failure: unknown
    try {
      await setup({
        provider: 'mock',
        backgroundMode: 'continuable',
      })
    } catch (error: unknown) {
      failure = error
    }
    expect(String(failure)).toContain(
      'provider "mock" does not support `backgroundMode: continuable`',
    )
  })

  it('registers a `subagent` tool that delegates to the configured provider and returns its output', async () => {
    const ctx = await setup({ provider: 'mock' }, { reply: 'child says hi' })
    const result = await callSubagent(ctx, {
      description: 'do a thing',
      prompt: 'go research X',
      run_in_background: false,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected subagent success')
    expect(result.value).toEqual({
      kind: 'foreground',
      runId: 'scripted-subagent:mock:parent-1',
      output: [{ type: 'text', text: 'child says hi' }],
    })
    expect(text(result)).toBe('child says hi')
  })

  it('exposes description + prompt + run_in_background to the model (no provider/type parameter)', async () => {
    const ctx = await setup({ provider: 'mock' })
    const schema = ctx.tools.schemas().find(s => s.name === 'subagent')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['description', 'prompt', 'run_in_background'])
    expect(schema!.description).toContain('job_output')
  })

  it('omits run_in_background entirely when the instance disables it (schema and capability never disagree)', async () => {
    const ctx = await setup({ provider: 'mock', enableRunInBackground: false })
    const schema = ctx.tools.schemas().find(s => s.name === 'subagent')
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['description', 'prompt'])
    expect(schema!.description).not.toContain('job_output')
  })

  it('refuses a forced run_in_background at execution time when the instance disables it', async () => {
    // Schema omission is advertising, not enforcement: the arg validator
    // allows undeclared keys, so the opt-out must also hold in execute().
    const ctx = await setup({ provider: 'mock', enableRunInBackground: false })
    const parent = { id: SessionId('sess-off'), inject: () => {}, options: {}, session: { header: { version: 0, id: 'sess-off', createdAt: 0 } } } as unknown as Agent

    const forced = await callSubagent(ctx, { description: 'd', prompt: 'p', run_in_background: true }, { agent: parent })
    expect(forced.isError).toBe(true)
    expect(text(forced)).toContain('run_in_background is disabled for this tool instance')
    // The provider was never asked to start a child.
    expect(ctx.subagents.getProvider('mock')).toBeDefined()
    const foreground = await callSubagent(ctx, { description: 'd', prompt: 'p' }, { agent: parent })
    expect(foreground.isError).toBe(false)
  })

  it('classifies foreground and background calls concurrency-safe (sibling delegations overlap)', async () => {
    const ctx = await setup({ provider: 'mock' })
    expect(ctx.tools.executionMode({
      signal: testToolSignal,
      callId: CallId('subagent-foreground'),
      name: 'subagent',
      arguments: { description: 'do work', prompt: 'Reply OK' },
    })).toEqual({ kind: 'parallel' })
    expect(ctx.tools.executionMode({
      signal: testToolSignal,
      callId: CallId('subagent-background'),
      name: 'subagent',
      arguments: { description: 'do work', prompt: 'Reply OK', run_in_background: true },
    })).toEqual({ kind: 'parallel' })
  })

  it('overlaps sibling foreground delegations dispatched concurrently', async () => {
    // Two children each block until both have started: hidden serialization
    // in the tool body, registry pipeline, or provider start path would
    // deadlock here instead of passing silently.
    const started: string[] = []
    let releaseBoth!: () => void
    const bothStarted = new Promise<void>((resolve) => { releaseBoth = resolve })
    const ctx = await setup({ provider: 'mock', enableRunInBackground: false }, {
      onStart: (request: SubagentStartRequest) => {
        started.push(request.label ?? '(unlabeled)')
        if (started.length === 2) releaseBoth()
        return bothStarted
      },
    })
    const results = await Promise.all([
      callSubagent(ctx, { description: 'first', prompt: 'p1' }),
      callSubagent(ctx, { description: 'second', prompt: 'p2' }),
    ])
    expect(started.sort()).toEqual(['first', 'second'])
    for (const result of results) expect(result.isError).toBe(false)
  })

  it.each([
    { stopReason: 'aborted' as const, fragment: 'cancelled' },
    { stopReason: 'error' as const, fragment: 'failed' },
    { stopReason: 'max-tokens' as const, fragment: 'token limit' },
    { stopReason: 'refusal' as const, fragment: 'declined' },
  ])('maps stop reason $stopReason to an isError result (not partial success)', async ({ stopReason, fragment }) => {
    const ctx = await setup({ provider: 'mock' }, { stopReason })
    const result = await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(fragment)
    // The failure is not partial success, but the child's preserved partial
    // answer still reaches the parent model inside the error result.
    expect(text(result)).toContain('scripted subagent reply')
  })

  it('registers under a configurable toolName so multiple providers can coexist', async () => {
    // The defining multi-provider use case: two loads, two distinct tool names,
    // each bound to a different provider — the tool registry rejects duplicate
    // names, so a configurable name is what makes this work.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await mock.mountScriptedProvider(ctx, { name: 'spawn', reply: 'from spawn' })
    await mock.mountScriptedProvider(ctx, { name: 'acp', reply: 'from acp' })
    await ctx.plugin(tool, { provider: 'spawn', toolName: 'subagent' })
    await ctx.plugin(tool, { provider: 'acp', toolName: 'subagent_acp' })

    const names = ctx.tools.schemas().map(s => s.name).filter(n => n.startsWith('subagent')).sort()
    expect(names).toEqual(['subagent', 'subagent_acp'])

    const viaSpawn = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c-spawn'), name: 'subagent', arguments: { description: 'd', prompt: 'p' }, agent: fakeAgent() })
    const viaAcp = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c-acp'), name: 'subagent_acp', arguments: { description: 'd', prompt: 'p' }, agent: fakeAgent() })
    expect(text(viaSpawn)).toBe('from spawn')
    expect(text(viaAcp)).toBe('from acp')
  })

  it('treats an unknown (plugin-added) stop reason as an isError result', async () => {
    // SubagentStopReason is merge-extensible; the tool's stopReasonError default
    // arm must treat an unrecognized terminal reason as a failure, not success.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'weird',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async () => ({
        id: SessionId('weird-child'),
        localAgent: undefined,
        result: Promise.resolve({ output: [{ type: 'text', text: 'partial' }], stopReason: 'frobnicated' as never }),
        dispose: async () => {},
      }),
    })
    await ctx.plugin(tool, { provider: 'weird', maxDepth: 'provider-managed' })

    const result = await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('abnormally')
  })

  it('forwards configured agentOptions into the start request', async () => {
    // Cover the `config.agentOptions ? … : {}` spread: a provider that captures
    // the request lets us assert the agentOptions reached it.
    let seen: { agentOptions?: { model?: string } } | undefined
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'capture',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async (request) => {
        seen = request
        return {
          id: SessionId('capture-child'),
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const }),
          dispose: async () => {},
        }
      },
    })
    await ctx.plugin(tool, { provider: 'capture', agentOptions: { model: 'child-model' }, maxDepth: 'provider-managed' })

    await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(seen?.agentOptions).toEqual({ model: 'child-model' })
  })

  it('defaults toolName and omits agentOptions when apply() is called directly (schema bypass)', async () => {
    // `ctx.plugin` validates+defaults config first (toolName→'subagent', the
    // agentOptions object→{}), so the runtime `?? 'subagent'` fallback and the
    // no-agentOptions branch are only reachable via a direct apply() that
    // bypasses schemastery — the same pattern acp-agent uses for its defaults.
    let seen: { agentOptions?: unknown } | undefined
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'bare',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async (request) => {
        seen = request
        return {
          id: SessionId('bare-child'),
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const }),
          dispose: async () => {},
        }
      },
    })
    // Direct apply with only `provider` — no toolName, no agentOptions.
    tool.apply(ctx, { provider: 'bare' })
    await new Promise(r => setTimeout(r, 10))

    expect(ctx.tools.schemas().some(s => s.name === 'subagent')).toBe(true)
    await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(seen?.agentOptions).toBeUndefined()
  })

  it('fails loud when invoked without a calling agent', async () => {
    const ctx = await setup({ provider: 'mock' })
    const result = await callSubagent(ctx, { description: 'd', prompt: 'p' }, { agent: undefined })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })

  it('registers when the provider appears LATER — no load-order requirement (Loader starts siblings concurrently)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    // Tool first: no provider yet — the tool must be absent, not broken.
    // Direct apply (schema bypass): also covers the waiting-note's default
    // toolName fallback, which validated config pre-fills.
    tool.apply(ctx, { provider: 'mock' })
    expect(ctx.tools.schemas().some(s => s.name === 'subagent')).toBe(false)
    // Backend arrives (as a delayed sibling fiber would): the tool appears.
    await mock.mountScriptedProvider(ctx, { name: 'mock', reply: 'late but fine' })
    expect(ctx.tools.schemas().some(s => s.name === 'subagent')).toBe(true)
    const result = await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(text(result)).toBe('late but fine')
  })

  it('keeps continuable guidance empty while its provider is absent', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    tool.apply(ctx, {
      provider: 'later-continuable',
      backgroundMode: 'continuable',
      maxDepth: 'provider-managed',
    })

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'tool:subagent')?.text).toBe('')
    expect(ctx.tools.schemas().some(schema => schema.name === 'subagent')).toBe(false)
  })

  it('mirrors the provider lifecycle: gone on backend dispose, re-derived wording on re-registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    const backend = await mock.mountScriptedProvider(ctx, { name: 'mock' }) // fresh conversation (descriptor: false)
    await ctx.plugin(tool, { provider: 'mock' })
    expect(ctx.tools.schemas().find(s => s.name === 'subagent')!.description).toContain('does not see this conversation')

    // Backend unloads (HMR shape): the tool must not outlive its provider.
    await backend.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'subagent')).toBe(false)

    // Backend reloads with a DIFFERENT conversation-history descriptor: the wording is re-derived
    // from the fresh provider, not served stale from the first mount.
    await mock.mountScriptedProvider(ctx, { name: 'mock', inheritsParentContext: true })
    expect(ctx.tools.schemas().find(s => s.name === 'subagent')!.description).toContain('inherits this conversation')
  })

  it('the tool PLUGIN fiber owns its lifecycle listeners: disposal unmounts, and a disposed fiber never zombie-mounts', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)

    // Arm 1: a mounted tool and its prompt section die with the plugin fiber;
    // the provider survives.
    ctx.subagents.registerProvider({
      name: 'continuable',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async () => { throw new Error('lifecycle test does not start a child') },
      prepareContinuable: async () => ({}),
    })
    const mounted = await ctx.plugin(tool, {
      provider: 'continuable',
      backgroundMode: 'continuable',
      maxDepth: 'provider-managed',
    })
    expect(ctx.tools.schemas().some(s => s.name === 'subagent')).toBe(true)
    expect((await ctx.systemPrompt.assemble()).sections.some(s => s.name === 'tool:subagent')).toBe(true)
    await mounted.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'subagent')).toBe(false)
    expect((await ctx.systemPrompt.assemble()).sections.some(s => s.name === 'tool:subagent')).toBe(false)
    expect(ctx.subagents.getProvider('continuable')).toBeDefined()

    // Arm 2: a fiber disposed while WAITING must not react to the provider
    // arriving later — a surviving listener would re-register a tool that no
    // live plugin owns (the zombie mount).
    const waiting = await ctx.plugin(tool, { provider: 'later', toolName: 'subagent_later' })
    await waiting.dispose()
    await mock.mountScriptedProvider(ctx, { name: 'later' })
    expect(ctx.tools.schemas().some(s => s.name === 'subagent_later')).toBe(false)
  })

  it('ignores lifecycle events for OTHER providers', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await mock.mountScriptedProvider(ctx, { name: 'mock' })
    await ctx.plugin(tool, { provider: 'mock' })
    // An unrelated provider registering (added-event with another name) and
    // unregistering (removed-event with another name) must not touch the tool.
    const other = await mock.mountScriptedProvider(ctx, { name: 'other', inheritsParentContext: true })
    expect(ctx.tools.schemas().filter(s => s.name === 'subagent')).toHaveLength(1)
    expect(ctx.tools.schemas().find(s => s.name === 'subagent')!.description).toContain('does not see this conversation')
    await other.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'subagent')).toBe(true)
  })

  it('derives spawn-shaped wording from a fresh-conversation provider (default mock)', async () => {
    const ctx = await setup({ provider: 'mock' })
    const schema = ctx.tools.schemas().find(s => s.name === 'subagent')!
    expect(schema.description).toContain('does not see this conversation')
    const props = (schema.parameters as { properties: Record<string, { description: string }> }).properties
    expect(props['prompt']!.description).toContain('include everything it needs')
  })

  it('derives inherited-context wording from a seeded-conversation provider', async () => {
    const ctx = await setup({ provider: 'mock', toolName: 'subagent' }, { inheritsParentContext: true })
    const schema = ctx.tools.schemas().find(s => s.name === 'subagent')!
    expect(schema.description).toContain('inherits this conversation')
    expect(schema.description).not.toContain('does not see this conversation')
    const props = (schema.parameters as { properties: Record<string, { description: string }> }).properties
    expect(props['prompt']!.description).toContain('completed turns')
  })

  it('disposes the run on the success path (no leaked child)', async () => {
    // Spy on the provider's run.dispose via a wrapping provider registered
    // directly on the service, then point the tool at it.
    const disposed = vi.fn()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'spy',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async () => ({
        id: SessionId('spy-child'),
        localAgent: undefined,
        result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const }),
        dispose: async () => void disposed(),
      }),
    })
    await ctx.plugin(tool, { provider: 'spy', maxDepth: 'provider-managed' })

    await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('disposes the run on the error path too', async () => {
    const disposed = vi.fn()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'spy',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async () => ({
        id: SessionId('spy-child'),
        localAgent: undefined,
        result: Promise.resolve({ output: [], stopReason: 'error' as const }),
        dispose: async () => void disposed(),
      }),
    })
    await ctx.plugin(tool, { provider: 'spy', maxDepth: 'provider-managed' })

    const result = await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(result.isError).toBe(true)
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('preserves independent foreground result and disposal failures', async () => {
    const disposed = vi.fn()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'spy',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async () => ({
        id: SessionId('spy-child'),
        localAgent: undefined,
        result: Promise.reject(new Error('published run failed')),
        dispose: async () => {
          disposed()
          throw new Error('published handle disposal failed')
        },
      }),
    })
    await ctx.plugin(tool, { provider: 'spy', maxDepth: 'provider-managed' })

    const result = await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('published run failed')
    expect(text(result)).toContain('published handle disposal failed')
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('reports a foreground disposal failure after a completed result', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'spy',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async () => ({
        id: SessionId('spy-child'),
        localAgent: undefined,
        result: Promise.resolve({
          output: [{ type: 'text', text: 'completed before disposal' }],
          stopReason: 'completed',
        }),
        dispose: () => Promise.reject(new Error('published handle disposal failed')),
      }),
    })
    await ctx.plugin(tool, { provider: 'spy', maxDepth: 'provider-managed' })

    const result = await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('published handle disposal failed')
  })

  it('passes the tool abort signal as the provider cancellation channel', async () => {
    const cancelled = vi.fn()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'spy',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async (request) => {
        if (request.signal.aborted) throw new Error('start aborted')
        let resolveResult: (r: { output: never[]; stopReason: 'aborted' }) => void
        const result = new Promise<{ output: never[]; stopReason: 'aborted' }>((res) => { resolveResult = res })
        request.signal.addEventListener('abort', () => {
          cancelled()
          resolveResult({ output: [], stopReason: 'aborted' })
        }, { once: true })
        return {
          id: SessionId('spy-child'),
          localAgent: undefined,
          result,
          dispose: async () => {},
        }
      },
    })
    await ctx.plugin(tool, { provider: 'spy', maxDepth: 'provider-managed' })

    const controller = new AbortController()
    const pending = callSubagent(ctx, { description: 'd', prompt: 'p' }, { signal: controller.signal })
    // Let provider.start install its listener before aborting.
    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    const result = await pending
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(result.isError).toBe(true)
  })

  it('skips provider startup for an already-aborted signal', async () => {
    const sawAborted = vi.fn()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'spy',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async (request) => {
        if (request.signal.aborted) sawAborted()
        throw new Error('start aborted')
      },
    })
    await ctx.plugin(tool, { provider: 'spy', maxDepth: 'provider-managed' })

    const controller = new AbortController()
    controller.abort() // already aborted BEFORE the tool runs
    const result = await callSubagent(ctx, { description: 'd', prompt: 'p' }, { signal: controller.signal })
    expect(sawAborted).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.error).toEqual({
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    })
  })

  it('tools depend on the service: no `subagent` tool without ctx.subagents', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    // No SubagentRuntime mounted. The tool injects its three required services so its
    // apply never runs; the tool is absent rather than half-registered.
    let booted = true
    try {
      await ctx.plugin(tool, { provider: 'mock' })
      await new Promise(r => setTimeout(r, 20))
    } catch {
      booted = false
    }
    // Either it never booted, or it booted but registered no tool.
    const present = ctx.get('tools')?.schemas().some(s => s.name === 'subagent') ?? false
    expect(booted && present).toBe(false)
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/Config/apply', () => {
    // Postmortem 0001 guard: this plugin HAS an explicit `inject`, so
    // a stray `export default apply` would collapse the module via
    // `unwrapExports` (`exports.default ?? exports`), DROP `inject`, and crash at
    // load with "cannot get property … without inject". Guard the shape directly.
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-subagent')
    expect(tool.inject).toEqual(['tools', 'subagents', 'systemPrompt'])

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(tool) as Record<string, unknown>
    expect(unwrapped).toBe(tool)
    expect(unwrapped.name).toBe('tool-subagent')
    expect(unwrapped.inject).toEqual(['tools', 'subagents', 'systemPrompt'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(unwrapped.Config).toBeDefined()
  })

  it('passes persona/toolFilter/maxDepth config through to the start request', async () => {
    let seen: { persona?: string; toolFilter?: unknown; maxDepth?: number } | undefined
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'capture2',
      capabilities: { outputSchema: false, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: async (request) => {
        seen = request
        return {
          id: SessionId('capture2-child'),
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const }),
          dispose: async () => {},
        }
      },
    })
    await ctx.plugin(tool, {
      provider: 'capture2',
      persona: 'You are the child.',
      toolFilter: { deny: ['subagent'] },
      maxDepth: 2,
    })

    await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(seen?.persona).toBe('You are the child.')
    expect(seen?.toolFilter).toMatchObject({ deny: ['subagent'] })
    expect(seen?.maxDepth).toBe(2)
  })

  it.each([
    { label: 'a string', value: '1' as unknown as number },
    { label: 'NaN', value: Number.NaN },
    { label: 'positive infinity', value: Number.POSITIVE_INFINITY },
    { label: 'negative infinity', value: Number.NEGATIVE_INFINITY },
    { label: 'a negative integer', value: -1 },
    { label: 'a fractional number', value: 1.5 },
    { label: 'negative zero', value: -0 },
    { label: 'an unsafe integer', value: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects maxDepth=$label when the plugin loads', async ({ value }) => {
    await expect(setup({ provider: 'mock', maxDepth: value }))
      .rejects.toThrow()
  })

  it('validates maxDepth when apply() is invoked directly without Schemastery', () => {
    const ctx = new Context()
    expect(() => {
      tool.apply(ctx, {
        provider: 'unused',
        maxDepth: Number.NaN,
      })
    }).toThrow('subagent maxDepth must be a non-negative safe integer')
  })

  it('a partial toolFilter (deny only) does not materialize an empty allow-list (deny-all trap)', async () => {
    let seen: { toolFilter?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] } } | undefined
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'capture3',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: true, persona: false },
      inheritsParentContext: false,
      start: async (request) => {
        seen = request
        return {
          id: SessionId('capture3-child'),
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const }),
          dispose: async () => {},
        }
      },
    })
    await ctx.plugin(tool, { provider: 'capture3', toolFilter: { deny: ['subagent'] }, maxDepth: 'provider-managed' })
    await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(seen?.toolFilter).toEqual({ deny: ['subagent'] })
    expect(seen?.toolFilter).not.toHaveProperty('allow')
  })

  it('an omitted agentOptions does not materialize an empty object onto the request', async () => {
    // Same schemastery trap as toolFilter, adjacent field: an omitted
    // `agentOptions` config key materializes `{}` without the forced default,
    // which reads as present and puts a dishonest `agentOptions: {}` on every
    // start request.
    let seen: { agentOptions?: unknown } | undefined
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'capture4',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async (request) => {
        seen = request
        return {
          id: SessionId('capture4-child'),
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const }),
          dispose: async () => {},
        }
      },
    })
    await ctx.plugin(tool, { provider: 'capture4', maxDepth: 'provider-managed' })
    await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(seen).toBeDefined()
    expect(seen).not.toHaveProperty('agentOptions')
  })

  it('an explicit empty toolFilter fails at plugin load, not at first delegation', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'p',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: true, persona: false },
      inheritsParentContext: false,
      start: () => { throw new Error('unreachable') },
    })
    const fiber = ctx.plugin(tool, { provider: 'p', toolFilter: {} })
    await expect(fiber).rejects.toThrow(/names neither `allow` nor `deny`/)
  })
})

describe('dsh-tool-subagent background mode', () => {
  /** A live parent with a dedicated scope fiber for structural task cleanup. */
  function ownerAgent(ctx: Context, sessionId: string, inject: (...args: unknown[]) => void = () => {}): Agent {
    const scopeFiber = ctx.plugin(() => {})
    const id = SessionId(sessionId)
    const agent = {
      id,
      ctx: scopeFiber.ctx,
      inject,
      options: {},
      session: { id, header: { version: 0, id, createdAt: 0 } },
    } as unknown as Agent
    ctx.agents.register(agent)
    return agent
  }

  async function backgroundSetup(toolConfig: tool.Config, mockConfig: Partial<mock.Config> = {}) {
    const ctx = await setup(toolConfig, mockConfig)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    await ctx.plugin(ToolTasks, {})
    return ctx
  }

  it('keeps a continuable-capable provider one-shot when backgroundMode selects one-shot', async () => {
    const ctx = await backgroundSetup({ provider: 'mock' })
    const parent = ownerAgent(ctx, 'sess-parent')
    let prepareCalls = 0
    ctx.subagents.registerProvider({
      name: 'resumable',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async request => ({
        id: SessionId('one-shot-child'),
        localAgent: undefined,
        result: Promise.resolve({
          output: [{ type: 'text', text: 'one-shot answer' }],
          stopReason: request.signal.aborted ? 'aborted' : 'completed',
        }),
        dispose: () => Promise.resolve(),
      }),
      prepareContinuable: async () => {
        prepareCalls += 1
        throw new Error('one-shot policy must not prepare a continuable child')
      },
    })
    tool.apply(ctx, {
      provider: 'resumable',
      toolName: 'subagent_resumable',
      backgroundMode: 'one-shot',
      maxDepth: 'provider-managed',
    })

    const started = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('resumable-one-shot'),
      name: 'subagent_resumable',
      arguments: { description: 'work', prompt: 'go', run_in_background: true },
      agent: parent,
    })

    expect(text(started)).toBe('started background subagent job subagent-1')
    expect(prepareCalls).toBe(0)
  })

  it('returns a job id immediately and the answer is collected through job_output', async () => {
    const ctx = await backgroundSetup({ provider: 'mock', agentOptions: { model: 'child-model' } }, { reply: 'background answer' })
    const parent = ownerAgent(ctx, 'sess-parent')

    const start = await callSubagent(ctx, { description: 'deep research', prompt: 'dig in', run_in_background: true }, { agent: parent })
    expect(start.isError).toBe(false)
    if (start.isError) throw new Error('expected background subagent success')
    expect(start.value).toEqual({ kind: 'background', jobId: 'subagent-1' })
    expect(text(start)).toBe('started background subagent job subagent-1')

    const collected = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('collect-1'),
      name: 'job_output',
      arguments: { job_id: 'subagent-1', wait: true },
      agent: parent,
    })
    expect(text(collected)).toBe('background answer\n[status: completed]')

    // Final-output reads are idempotent (not consumed).
    const again = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('collect-2'),
      name: 'job_output',
      arguments: { job_id: 'subagent-1' },
      agent: parent,
    })
    expect(text(again)).toBe('background answer\n[status: completed]')
  })

  it('fails loud when the tasks runtime is not loaded', async () => {
    const ctx = await setup({ provider: 'mock' })
    const result = await callSubagent(ctx, { description: 'd', prompt: 'p', run_in_background: true })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('background jobs unavailable: load @deepseek-ai/dsh-jobs')
  })

  it('skips background startup when the tool signal is already aborted', async () => {
    const ctx = await backgroundSetup({ provider: 'mock' })
    const parent = ownerAgent(ctx, 'sess-parent')
    const controller = new AbortController()
    controller.abort()
    const result = await callSubagent(ctx, { description: 'd', prompt: 'p', run_in_background: true }, { agent: parent, signal: controller.signal })
    expect(result.isError).toBe(true)
    expect(result.error).toEqual({
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    })
    expect(text(result)).toBe('Error: tool call aborted before dispatch')
  })

  it('settles an asynchronous provider-start failure as a failed task', async () => {
    const ctx = await backgroundSetup({ provider: 'mock' })
    const parent = ownerAgent(ctx, 'sess-parent')
    ctx.subagents.registerProvider({
      name: 'broken-start',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async () => { throw new Error('setup failed') },
    })
    tool.apply(ctx, { provider: 'broken-start', toolName: 'subagent_broken' })

    const started = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('broken-start'),
      name: 'subagent_broken',
      arguments: { description: 'broken', prompt: 'p', run_in_background: true },
      agent: parent,
    })
    expect(text(started)).toBe('started background subagent job subagent-1')
    const output = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('broken-output'),
      name: 'job_output',
      arguments: { job_id: 'subagent-1', wait: true },
      agent: parent,
    })
    expect(text(output)).toContain('[status: failed, Error: setup failed]')
  })

  it('kills a subagent task while provider readiness is still pending', async () => {
    const ctx = await backgroundSetup({ provider: 'mock' })
    const parent = ownerAgent(ctx, 'sess-parent')
    ctx.subagents.registerProvider({
      name: 'pending-start',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: request => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => { reject(new Error('startup aborted')) }, { once: true })
      }),
    })
    tool.apply(ctx, { provider: 'pending-start', toolName: 'subagent_pending' })

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('pending-start'),
      name: 'subagent_pending',
      arguments: { description: 'pending', prompt: 'p', run_in_background: true },
      agent: parent,
    })
    await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('pending-kill'),
      name: 'job_kill',
      arguments: { job_id: 'subagent-1', reason: 'no longer needed' },
      agent: parent,
    })
    const output = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('pending-output'),
      name: 'job_output',
      arguments: { job_id: 'subagent-1', wait: true },
      agent: parent,
    })
    expect(text(output)).toBe('(no new output)\n[status: killed]')
  })

  it('reports startup rollback failure after cancellation as a failed job', async () => {
    const ctx = await backgroundSetup({ provider: 'mock' })
    const parent = ownerAgent(ctx, 'sess-parent')
    ctx.subagents.registerProvider({
      name: 'broken-start-rollback',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: request => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new AggregateError(
            [new Error('startup aborted'), new Error('cleanup failed')],
            'startup failed and cleanup also failed',
          ))
        }, { once: true })
      }),
    })
    tool.apply(ctx, { provider: 'broken-start-rollback', toolName: 'subagent_broken_rollback' })

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('broken-rollback-start'),
      name: 'subagent_broken_rollback',
      arguments: { description: 'broken rollback', prompt: 'p', run_in_background: true },
      agent: parent,
    })
    await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('broken-rollback-kill'),
      name: 'job_kill',
      arguments: { job_id: 'subagent-1' },
      agent: parent,
    })
    const output = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('broken-rollback-output'),
      name: 'job_output',
      arguments: { job_id: 'subagent-1', wait: true },
      agent: parent,
    })
    expect(text(output)).toContain('[status: failed, AggregateError: startup failed and cleanup also failed]')
  })

  it('forwards job_kill reasons through the run signal (and defaults one when absent)', async () => {
    // Use a provider that remains live until its signal is aborted.
    const ctx = await backgroundSetup({ provider: 'mock', agentOptions: { model: 'child-model' } })
    const parent = ownerAgent(ctx, 'sess-parent')
    const cancels: (string | undefined)[] = []
    let starts = 0
    ctx.subagents.registerProvider({
      name: 'hanging',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async (request) => {
        let settle!: (value: { output: { type: 'text'; text: string }[]; stopReason: 'aborted' }) => void
        const id = SessionId(`hang-${++starts}`)
        const result = new Promise<{ output: { type: 'text'; text: string }[]; stopReason: 'aborted' }>((res) => { settle = res })
        request.signal.addEventListener('abort', () => {
          cancels.push(typeof request.signal.reason === 'string' ? request.signal.reason : undefined)
          settle({ output: [], stopReason: 'aborted' })
        }, { once: true })
        return {
          id,
          localAgent: undefined,
          result,
          dispose: () => Promise.resolve(),
        }
      },
    })
    // Direct apply preserves omitted agentOptions instead of applying schema defaults.
    tool.apply(ctx, { provider: 'hanging', toolName: 'subagent_hang' })

    const startOne = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('h1'), name: 'subagent_hang', arguments: { description: 'one', prompt: 'p', run_in_background: true }, agent: parent })
    const startTwo = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('h2'), name: 'subagent_hang', arguments: { description: 'two', prompt: 'p', run_in_background: true }, agent: parent })
    expect(text(startOne)).toBe('started background subagent job subagent-1')
    expect(text(startTwo)).toBe('started background subagent job subagent-2')

    const withReason = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('k1'), name: 'job_kill', arguments: { job_id: 'subagent-1', reason: 'superseded' }, agent: parent })
    const withoutReason = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('k2'), name: 'job_kill', arguments: { job_id: 'subagent-2' }, agent: parent })
    expect(text(withReason)).toBe('requested cancellation of job subagent-1')
    expect(text(withoutReason)).toBe('requested cancellation of job subagent-2')
    expect(cancels).toEqual(['superseded', 'background subagent task killed'])

    // The aborted children settle as killed tasks.
    const killed = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('w1'), name: 'job_output', arguments: { job_id: 'subagent-1', wait: true }, agent: parent })
    expect(text(killed)).toBe('(no new output)\n[status: killed]')
  })

})

describe('dsh-tool-subagent continuable background mode', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  /** Boot the real continuable stack without any model-facing follow-up adapter. */
  async function continuableSetup() {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const root = mkdtempSync(path.join(tmpdir(), 'dsh-tool-subagent-continuable-'))
    roots.push(root)
    await ctx.plugin(JsonlSessionPersistence, { root })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    await ctx.plugin(LocalJobRegistry)
    await ctx.plugin(ToolTasks, {})
    await ctx.plugin(tool, { provider: 'spawn', backgroundMode: 'continuable' })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      textResponse('continuable answer'),
    ]))
    const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
    return { ctx, parent }
  }

  it('classifies continuable background calls concurrency-safe', async () => {
    const { ctx } = await continuableSetup()
    expect(ctx.tools.executionMode({
      signal: testToolSignal,
      callId: CallId('subagent-continuable'),
      name: 'subagent',
      arguments: { description: 'do work', prompt: 'Reply OK' },
    })).toEqual({ kind: 'parallel' })
  })

  it('defaults continuable delegation to background and returns only its durable id', async () => {
    const { ctx, parent } = await continuableSetup()
    const schema = ctx.tools.schemas().find(s => s.name === 'subagent')!
    // Continuable delegation has no Task, so the schema promises no collection.
    expect(schema.description).not.toContain('job_output')
    expect(schema.description).not.toContain('job_kill')
    expect(schema.description).toContain('send_message')
    expect(schema.description).toContain('runs in the background by default')
    expect(schema.description).not.toContain('never poll or wait on it')
    const properties = (schema.parameters as {
      properties: Record<string, { description?: string }>
    }).properties
    expect(properties.run_in_background?.description).toContain('Defaults to true')
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(parent))
    const guidance = assembly.sections.find(section => section.name === 'tool:subagent')
    expect(guidance?.text).toContain('Use subagent in the background by default')
    expect(guidance?.text).toContain('runtime sends you a notice containing its outcome')

    const started = await callSubagent(
      ctx,
      { description: 'continuable work', prompt: 'dig in' },
      { agent: parent },
    )
    expect(started.isError).toBe(false)
    const match = /^started subagent (\S+)$/.exec(text(started))
    expect(match).not.toBeNull()
    const [, childId] = match!
    // No Task was created for the continuable child.
    expect(ctx.jobs.list(parent)).toEqual([])

    await vi.waitFor(() => {
      expect(ctx.agents.get(SessionId(childId!))).toBeUndefined()
    }, { timeout: 5_000 })
    // The child id names a durable session carrying its continuation descriptor.
    const loaded = await ctx.sessionPersistence.load(SessionId(childId!))
    expect(loaded.events.some(event => event.type === 'subagent/descriptor')).toBe(true)
    expect(loaded.events.some(event => event.type === 'assistant/message')).toBe(true)
  })

  it('hides continuable guidance when the current agent cannot see the tool', async () => {
    const { ctx, parent } = await continuableSetup()
    parent.ctx.tools.restrict({ deny: ['subagent'] })

    expect(ctx.tools.get('subagent', parent)).toBeUndefined()
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(parent))
    expect(assembly.sections.find(section => section.name === 'tool:subagent')?.text).toBe('')
  })

  it('waits for a continuable provider only when run_in_background is explicitly false', async () => {
    const { ctx, parent } = await continuableSetup()
    const result = await callSubagent(
      ctx,
      { description: 'blocking work', prompt: 'dig in', run_in_background: false },
      { agent: parent },
    )
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected foreground subagent success')
    expect(result.value).toMatchObject({ kind: 'foreground' })
    expect(text(result)).toBe('continuable answer')
    expect(ctx.jobs.list(parent)).toEqual([])
  })

  it('isolates a cancelled continuable preparation from a concurrent sibling', async () => {
    const { ctx, parent } = await continuableSetup()
    const bothPreparing = Promise.withResolvers<undefined>()
    const releasePreparations = Promise.withResolvers<undefined>()
    const cancelled = new AbortController()
    let preparationCount = 0
    let cancelledChildId: ReturnType<typeof SessionId> | undefined
    let survivingChildId: ReturnType<typeof SessionId> | undefined
    ctx.subagents.registerProvider({
      name: 'gated',
      capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: async () => { throw new Error('continuable policy must not start a one-shot child') },
      prepareContinuable: async (request) => {
        preparationCount += 1
        if (request.signal === cancelled.signal) cancelledChildId = request.sessionId
        else survivingChildId = request.sessionId
        if (preparationCount === 2) bothPreparing.resolve(undefined)
        await releasePreparations.promise
        return {}
      },
    })
    tool.apply(ctx, {
      provider: 'gated',
      toolName: 'subagent_gated',
      backgroundMode: 'continuable',
      maxDepth: 3,
    })

    const execute = (callId: string, description: string, signal: AbortSignal) => ctx.tools.execute({
      signal,
      callId: CallId(callId),
      name: 'subagent_gated',
      arguments: { description, prompt: 'work', run_in_background: true },
      agent: parent,
    })
    const cancelledResult = execute('continuable-cancelled', 'cancelled sibling', cancelled.signal)
    const survivingResult = execute('continuable-surviving', 'surviving sibling', testToolSignal)
    await bothPreparing.promise
    cancelled.abort()
    releasePreparations.resolve(undefined)

    const [failed, succeeded] = await Promise.all([cancelledResult, survivingResult])
    expect(preparationCount).toBe(2)
    expect(failed.isError).toBe(true)
    expect(succeeded.isError).toBe(false)
    expect(cancelledChildId).toBeDefined()
    expect(survivingChildId).toBeDefined()
    expect(ctx.agents.get(cancelledChildId!)).toBeUndefined()
    await expect(ctx.sessionPersistence.load(cancelledChildId!)).rejects.toThrow(/not found/)

    expect(succeeded.isError ? undefined : succeeded.value).toEqual({
      kind: 'continuable',
      subagentId: survivingChildId,
    })
    await vi.waitFor(() => {
      expect(ctx.agents.get(survivingChildId!)).toBeUndefined()
    }, { timeout: 5_000 })
    const loaded = await ctx.sessionPersistence.load(survivingChildId!)
    expect(loaded.events.some(event => event.type === 'subagent/descriptor')).toBe(true)
    expect(loaded.events.some(event => event.type === 'assistant/message')).toBe(true)
  })

})

describe('background preflight failure (no orphaned child, by construction)', () => {
  it('never starts the child when tasks.start preflight throws', async () => {
    // With no job controller, preflight fails before the provider can spawn.
    const ctx = await setup({ provider: 'mock' })
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    const scopeFiber = ctx.plugin(() => {})
    const id = SessionId('sess-p')
    const parent = {
      id,
      ctx: scopeFiber.ctx,
      inject: () => {},
      options: {},
      session: { id, header: { version: 0, id, createdAt: 0 } },
    } as unknown as Agent
    ctx.agents.register(parent)

    let starts = 0
    ctx.subagents.registerProvider({
      name: 'probe',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async () => {
        starts += 1
        return {
          id: SessionId('probe-child'),
          localAgent: undefined,
          result: Promise.resolve({ output: [], stopReason: 'completed' as const }),
          dispose: () => Promise.resolve(),
        }
      },
    })
    tool.apply(ctx, { provider: 'probe', toolName: 'subagent_probe' })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('probe-1'),
      name: 'subagent_probe',
      arguments: { description: 'd', prompt: 'p', run_in_background: true },
      agent: parent,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no job controller serves this agent')
    // Declare-then-execute: the failed preflight means no child ever existed.
    expect(starts).toBe(0)
  })
})

describe('depth budget configuration', () => {
  /** Mount the tool over a request-capturing provider with full capabilities. */
  async function captureSetup(config: Omit<tool.Config, 'provider'> = {}) {
    const requests: SubagentStartRequest[] = []
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'capture',
      capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: async (request) => {
        requests.push(request)
        return {
          id: SessionId(`capture-child-${requests.length}`),
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const }),
          dispose: async () => {},
        }
      },
    })
    await ctx.plugin(tool, { provider: 'capture', ...config })
    return { ctx, requests }
  }

  it('defaults maxDepth to 3 and forwards it in the start request', async () => {
    const { ctx, requests } = await captureSetup()
    await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(requests[0]?.label).toBe('d')
    expect(requests[0]?.maxDepth).toBe(3)
    expect(requests[0]?.toolFilter).toBeUndefined()
  })

  it('forwards an explicit tool filter unchanged instead of encoding the depth policy into it', async () => {
    const { ctx, requests } = await captureSetup({ toolFilter: { deny: ['dangerous'] }, maxDepth: 0 })
    await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(requests[0]?.maxDepth).toBe(0)
    expect(requests[0]?.toolFilter).toEqual({ deny: ['dangerous'] })
  })

  it('rejects a numeric maxDepth on a provider without the depthLimit capability at mount', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'no-depth',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async () => { throw new Error('unreachable') },
    })
    await expect(ctx.plugin(tool, { provider: 'no-depth' }))
      .rejects.toThrow(/provider-managed/)
  })

  it("'provider-managed' omits the cap so a capability-less provider mounts and starts", async () => {
    const requests: SubagentStartRequest[] = []
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'external',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async (request) => {
        requests.push(request)
        return {
          id: SessionId('external-child'),
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const }),
          dispose: async () => {},
        }
      },
    })
    await ctx.plugin(tool, { provider: 'external', maxDepth: 'provider-managed' })
    await callSubagent(ctx, { description: 'd', prompt: 'p' })
    expect(requests[0]?.maxDepth).toBeUndefined()
    expect(requests[0]?.toolFilter).toBeUndefined()
  })
})
