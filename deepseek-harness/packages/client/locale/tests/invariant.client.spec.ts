// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-locale'
import { apply as clientApply, COMMON_NS, LocaleRuntime, inject } from '@deepseek-ai/dsh-client-locale/client'
import * as LocaleInvariant from '@deepseek-ai/dsh-client-locale/invariant'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(LocaleInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply tolerates a Host without settings', () => {
    nodeApply(new Context())
  })

  it('client apply provides ctx.locale seeded with the zh/en common namespace', async () => {
    // The feature registers its own Language settings row, hence the slots edge.
    expect(inject).toEqual(['slots', 'connection', 'remote', 'settingsScope'])
    const ctx = new Context()
    new SlotRegistry(ctx)
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    // The settings row's transport and the forwarded-event port.
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin({ inject, apply: clientApply }).await()
    const locale = ctx.get('locale')
    expect(locale).toBeInstanceOf(LocaleRuntime)
    // Seeded dictionaries occupy the (ns, locale) seats even while empty.
    expect(() => (locale as LocaleRuntime).register(COMMON_NS, 'zh', {})).toThrow('already has locale')
    expect(() => (locale as LocaleRuntime).register(COMMON_NS, 'en', {})).toThrow('already has locale')
  })
})
