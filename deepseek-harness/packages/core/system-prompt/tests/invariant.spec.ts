import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import * as SystemPromptInvariant from '@deepseek-ai/dsh-system-prompt/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SystemPromptInvariant)
  return ctx
}

const valid = (): PromptAssembly => ({
  sections: [{ name: 'identity', text: 'prompt' }],
  contexts: [{ name: 'policy', text: 'current policy' }],
  tools: [{ name: 'echo', description: 'Echo', parameters: {} }],
  variables: { cwd: '/repo', optional: undefined },
})

async function assemble(ctx: Context, result: PromptAssembly): Promise<PromptAssembly> {
  return ctx.waterfall(
    ctx as never, 'system-prompt/assemble', valid(), {},
    () => Promise.resolve(result),
  )
}

describe('system-prompt invariants', () => {
  it('accepts a well-formed authoritative assembly', async () => {
    const ctx = await setup()
    await expect(assemble(ctx, valid())).resolves.toEqual(valid())
  })

  it.each([
    [{ ...valid(), sections: [{ name: '', text: 'x' }] }, /section names must be non-empty/],
    [{ ...valid(), sections: [{ name: 'x', text: 'a' }, { name: 'x', text: 'b' }] }, /section name "x" is duplicated/],
    [{ ...valid(), sections: [{ name: 'x', text: 1 as never }] }, /section "x" text must be a string/],
    [{ ...valid(), contexts: [{ name: '', text: 'x' }] }, /context names must be non-empty/],
    [{ ...valid(), contexts: [{ name: 'x', text: 'a' }, { name: 'x', text: 'b' }] }, /context name "x" is duplicated/],
    [{ ...valid(), contexts: [{ name: 'x', text: 1 as never }] }, /context "x" text must be a string/],
    [{ ...valid(), tools: [{ name: '', description: 'x', parameters: {} }] }, /tool names must be non-empty/],
    [{ ...valid(), variables: { Bad: 'x' } }, /variable name "Bad" is invalid/],
    [{ ...valid(), variables: { value: 1 as never } }, /variable "value" must be a string or undefined/],
  ])('rejects malformed authoritative assembly %#', async (assembly, message) => {
    const ctx = await setup()
    await expect(assemble(ctx, assembly)).rejects.toThrow(message)
  })
})
