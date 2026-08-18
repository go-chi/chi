import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import * as SessionLogDownload from '../src/index.ts'

describe('/export Web download command', () => {
  it('registers one pathless command and removes it with the plugin fiber', async () => {
    let descriptor: CommandDefinition | undefined
    const ctx = new Context()
    ctx.provide('commands', {
      register(next: CommandDefinition) {
        descriptor = next
        return () => { descriptor = undefined }
      },
    } as never)
    const fiber = await ctx.plugin(SessionLogDownload)

    expect(descriptor).toMatchObject({
      name: 'export',
      description: 'Download this Session log as a ZIP archive',
    })
    const invoke = (rawInput: string) => descriptor?.handler({ rawInput } as CommandInvocation)
    await expect(invoke('')).resolves.toEqual({
      kind: 'success', text: 'Session log download requested.',
    })
    await expect(invoke(' output.zip')).resolves.toEqual({
      kind: 'error', text: 'The Web /export command does not accept a path.',
    })

    await fiber.dispose()
    expect(descriptor).toBeUndefined()
  })
})
