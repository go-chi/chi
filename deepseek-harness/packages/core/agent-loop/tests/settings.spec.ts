/** The `agent-loop` settings section layered over the composition entry. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import AgentLoop, { AGENT_LOOP_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-loop'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function boot(): Promise<{ ctx: Context; settingsFiber: Fiber; loopFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const loopFiber = ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 4 })
  await loopFiber.await()
  return { ctx, settingsFiber, loopFiber }
}

describe('agent-loop settings section', () => {
  it('layers the stored parallel cap over the composition entry', async () => {
    const bench = await boot()
    expect(bench.ctx.agentLoop.config.maxParallelToolCalls).toBe(4)

    await bench.ctx.settings.update(AGENT_LOOP_SETTINGS_NAMESPACE, { maxParallelToolCalls: 1 })

    expect(bench.ctx.agentLoop.config.maxParallelToolCalls).toBe(1)
    await bench.ctx.fiber.dispose()
  })

  it('refuses a non-positive cap at the write', async () => {
    const bench = await boot()

    await expect(bench.ctx.settings.update(AGENT_LOOP_SETTINGS_NAMESPACE, { maxParallelToolCalls: 0 }))
      .rejects.toThrow()

    expect(bench.ctx.agentLoop.config.maxParallelToolCalls).toBe(4)
    await bench.ctx.fiber.dispose()
  })

  it('never offers the composed agents array to the settings document', async () => {
    const bench = await boot()

    const descriptor = bench.ctx.settings.describe().find(row => String(row.ns) === 'agent-loop')

    expect(Object.keys(descriptor?.value as object)).toEqual(['maxParallelToolCalls'])
    await bench.ctx.fiber.dispose()
  })

  it('keeps serving the composed agents array to its own consumers', async () => {
    const bench = await boot()

    await bench.ctx.settings.update(AGENT_LOOP_SETTINGS_NAMESPACE, { maxParallelToolCalls: 2 })

    expect(bench.ctx.agentLoop.config.agents).toEqual([])
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(AGENT_LOOP_SETTINGS_NAMESPACE, { maxParallelToolCalls: 1 })
    expect(bench.ctx.agentLoop.config.maxParallelToolCalls).toBe(1)

    await bench.settingsFiber.dispose()

    expect(bench.ctx.agentLoop.config.maxParallelToolCalls).toBe(4)
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the service unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('agent-loop')

    await bench.loopFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('agent-loop')
    await bench.ctx.fiber.dispose()
  })
})
