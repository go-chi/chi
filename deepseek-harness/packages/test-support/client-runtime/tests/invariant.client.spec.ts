import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as TestRuntimeInvariant from '@deepseek-ai/dsh-client-test-runtime/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(TestRuntimeInvariant).await()).resolves.toBeDefined()
  })
})
