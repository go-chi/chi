import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { apply } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('ui-user-questions node plugin', () => {
  it('mounts no model-facing tool', async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(UserQuestionService)

    await ctx.plugin({ apply }).await()

    // Selecting the Web question FEATURE must not hand every agent the tool.
    // `ctx.tools.register` on an unscoped host context files into the global
    // layer, which merges into every agent's view regardless of the preset
    // that composed it — so a two-tool benchmark preset would really present
    // three. The `tool-ask-user` row belongs to the presets that want it.
    expect(ctx.tools.get('ask_user_question')).toBeUndefined()
  })
})
