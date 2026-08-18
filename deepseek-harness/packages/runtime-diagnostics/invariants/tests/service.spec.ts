import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import InvariantRegistry, {
  InvariantError,
  type Config,
} from '@deepseek-ai/dsh-invariants'

declare module '@deepseek-ai/cordis' {
  interface Context {
    invariantProbe: InvariantProbeService
  }

  interface Events {
    'invariants-test/ping'(): void
  }
}

class InvariantProbeService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'invariantProbe')
  }
}

interface RuntimeRegistration extends PromiseLike<() => void> {
  (): void | Promise<void>
}

interface InstalledRegistration {
  dispose(): Promise<void>
}

function runtimeRegistration(registration: () => void): RuntimeRegistration {
  return registration as RuntimeRegistration
}

async function setup(config: Config = {}): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>> }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(InvariantRegistry, config)
  return { ctx, fiber }
}

async function registerProbe(
  ctx: Context,
  packageName: string,
  probe: () => void,
): Promise<InstalledRegistration> {
  const registration = runtimeRegistration(ctx.invariants.register(packageName, (child) => {
    child.on('invariants-test/ping', probe, { global: true })
  }))
  await registration
  return {
    async dispose() { await registration() },
  }
}

describe('InvariantRegistry selection', () => {
  it('applies defaults when constructed directly without schema normalization', async () => {
    const ctx = new Context()
    const service = new InvariantRegistry(ctx)
    const probe = vi.fn()
    const registration = runtimeRegistration(service.register('@deepseek-ai/dsh-session', (child) => {
      child.on('invariants-test/ping', probe, { global: true })
    }))
    await registration
    ctx.emit('invariants-test/ping')
    expect(probe).toHaveBeenCalledOnce()
    await registration()
  })

  it('enables registrations by default and treats empty lists as admit-all and exclude-none', async () => {
    for (const config of [{}, { package_allowlist: [], package_blocklist: [] }]) {
      const { ctx } = await setup(config)
      const probe = vi.fn()
      await registerProbe(ctx, '@deepseek-ai/dsh-session', probe)
      ctx.emit('invariants-test/ping')
      expect(probe).toHaveBeenCalledOnce()
    }
  })

  it('disables every installer while still reserving package ownership', async () => {
    const { ctx } = await setup({ enabled: false })
    const probe = vi.fn()
    const registration = await registerProbe(ctx, '@deepseek-ai/dsh-session', probe)
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-session', () => {}))
      .toThrow(/already registered/)
    ctx.emit('invariants-test/ping')
    expect(probe).not.toHaveBeenCalled()
    await registration.dispose()
  })

  it('uses unanchored, case-sensitive JavaScript regex sources', async () => {
    const unanchored = await setup({ package_allowlist: ['session'] })
    const unanchoredProbe = vi.fn()
    await registerProbe(unanchored.ctx, '@deepseek-ai/dsh-session-extra', unanchoredProbe)
    unanchored.ctx.emit('invariants-test/ping')
    expect(unanchoredProbe).toHaveBeenCalledOnce()

    const anchored = await setup({ package_allowlist: ['^@deepseek-ai/dsh-session$'] })
    const anchoredProbe = vi.fn()
    await registerProbe(anchored.ctx, '@deepseek-ai/dsh-session-extra', anchoredProbe)
    anchored.ctx.emit('invariants-test/ping')
    expect(anchoredProbe).not.toHaveBeenCalled()

    const caseSensitive = await setup({ package_allowlist: ['Session'] })
    const caseProbe = vi.fn()
    await registerProbe(caseSensitive.ctx, '@deepseek-ai/dsh-session', caseProbe)
    caseSensitive.ctx.emit('invariants-test/ping')
    expect(caseProbe).not.toHaveBeenCalled()
  })

  it('lets the blocklist override an allowlist match', async () => {
    const { ctx } = await setup({
      package_allowlist: ['^@deepseek-ai/dsh-'],
      package_blocklist: ['session'],
    })
    const sessionProbe = vi.fn()
    const agentProbe = vi.fn()
    await registerProbe(ctx, '@deepseek-ai/dsh-session', sessionProbe)
    await registerProbe(ctx, '@deepseek-ai/dsh-agent', agentProbe)
    ctx.emit('invariants-test/ping')
    expect(sessionProbe).not.toHaveBeenCalled()
    expect(agentProbe).toHaveBeenCalledOnce()
  })

  it('accepts zero-match patterns for packages registered later', async () => {
    const { ctx } = await setup({ package_allowlist: ['^@later/invariants$'] })
    const now = vi.fn()
    const later = vi.fn()
    await registerProbe(ctx, '@deepseek-ai/dsh-session', now)
    await registerProbe(ctx, '@later/invariants', later)
    ctx.emit('invariants-test/ping')
    expect(now).not.toHaveBeenCalled()
    expect(later).toHaveBeenCalledOnce()
  })

  it('allows the same source in both lists and applies blocklist precedence', async () => {
    const { ctx } = await setup({ package_allowlist: ['agent'], package_blocklist: ['agent'] })
    const probe = vi.fn()
    await registerProbe(ctx, '@deepseek-ai/dsh-agent', probe)
    ctx.emit('invariants-test/ping')
    expect(probe).not.toHaveBeenCalled()
  })
})

describe('InvariantRegistry validation', () => {
  it.each([
    [{ package_allowlist: [''] }, /non-blank/],
    [{ package_allowlist: [' '] }, /non-blank/],
    [{ package_allowlist: [' session'] }, /surrounding whitespace/],
    [{ package_blocklist: ['session '] }, /surrounding whitespace/],
    [{ package_allowlist: ['session', 'session'] }, /duplicate regex/],
    [{ package_blocklist: ['agent', 'agent'] }, /duplicate regex/],
    [{ package_allowlist: ['['] }, /invalid regex/],
    [{ package_blocklist: ['('] }, /invalid regex/],
  ])('rejects malformed filter config %#', async (config, message) => {
    await expect((async () => {
      const ctx = new Context()
      await ctx.plugin(InvariantRegistry, config)
    })()).rejects.toThrow(message)
  })

  it.each(['', ' ', ' package', 'pack age', 'package\n'])('rejects malformed package name %j', async (packageName) => {
    const { ctx } = await setup()
    expect(() => ctx.invariants.register(packageName, () => {})).toThrow(/packageName/)
  })
})

describe('InvariantRegistry lifecycle', () => {
  it('honors the installer dependency API in its child fiber', async () => {
    const { ctx } = await setup()
    await ctx.plugin(InvariantProbeService)
    let registration!: RuntimeRegistration
    await ctx.plugin({
      inject: ['invariants', 'invariantProbe'],
      apply(child: Context) {
        const installer = Object.assign((installerCtx: Context) => {
          expect(Object.keys(installerCtx.fiber.inject)).toContain('invariantProbe')
          expect(Object.keys(installerCtx.fiber.store ?? {})).toContain('invariantProbe')
          expect(installerCtx.invariantProbe).toBeInstanceOf(InvariantProbeService)
        }, { inject: ['invariantProbe'] })
        expect(installer.inject).toEqual(['invariantProbe'])
        registration = runtimeRegistration(child.invariants.register('@deepseek-ai/dsh-probe', installer))
        return Promise.resolve(registration)
      },
    })
    await registration
  })

  it('attributes failures to the registering package with the stable code', async () => {
    const { ctx } = await setup()
    const registration = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-session', (child, fail) => {
      child.on('invariants-test/ping', () => fail('seq must strictly increase'), { global: true })
    }))
    await registration
    let caught: unknown
    try {
      ctx.emit('invariants-test/ping')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(InvariantError)
    expect(caught).toMatchObject({
      name: 'InvariantError',
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session',
      message: 'invariant violated by "@deepseek-ai/dsh-session": seq must strictly increase',
    })
  })

  it('disposes the child fiber completely and permits HMR re-registration', async () => {
    const { ctx } = await setup()
    const first = vi.fn()
    const firstRegistration = await registerProbe(ctx, '@deepseek-ai/dsh-session', first)
    ctx.emit('invariants-test/ping')
    await firstRegistration.dispose()
    ctx.emit('invariants-test/ping')
    expect(first).toHaveBeenCalledOnce()

    const second = vi.fn()
    await registerProbe(ctx, '@deepseek-ai/dsh-session', second)
    ctx.emit('invariants-test/ping')
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('reserves ownership until asynchronous child disposal completes', async () => {
    const { ctx } = await setup()
    let finishDisposal!: () => void
    const disposalBarrier = new Promise<void>((resolve) => { finishDisposal = resolve })
    const registration = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-session', (child) => {
      child.effect(() => async () => { await disposalBarrier })
    }))
    await registration

    const disposing = registration()
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-session', () => {}))
      .toThrow(/already registered/)
    finishDisposal()
    await disposing

    const replacement = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-session', () => {}))
    await replacement
    await replacement()
  })

  it('rolls back listeners and ownership atomically when an installer fails', async () => {
    const { ctx } = await setup()
    const leaked = vi.fn()
    const failed = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-session', (child) => {
      child.on('invariants-test/ping', leaked, { global: true })
      throw new Error('installer failed')
    }))
    await expect(Promise.resolve(failed)).rejects.toThrow('installer failed')
    ctx.emit('invariants-test/ping')
    expect(leaked).not.toHaveBeenCalled()

    const retry = vi.fn()
    await registerProbe(ctx, '@deepseek-ai/dsh-session', retry)
    ctx.emit('invariants-test/ping')
    expect(retry).toHaveBeenCalledOnce()
  })

  it('rolls back publication effects and ownership when child-fiber publication fails', async () => {
    const { ctx } = await setup()
    const leaked = vi.fn()
    let rejectPublication = true
    const stopRejecting = ctx.on('internal/plugin', (fiber) => {
      if (!rejectPublication || fiber.uid === null) return
      rejectPublication = false
      fiber.ctx.on('invariants-test/ping', leaked, { global: true })
      throw new Error('publication failed')
    })

    const failed = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-publication-probe', () => {}))
    await expect(Promise.resolve(failed)).rejects.toThrow('publication failed')
    ctx.emit('invariants-test/ping')
    expect(leaked).not.toHaveBeenCalled()
    stopRejecting()

    const retry = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-publication-probe', () => {}))
    await retry
    await retry()
  })

  it('joins asynchronous checks and rolls back their effects on failure', async () => {
    const { ctx } = await setup()
    const leaked = vi.fn()
    const failed = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-async-probe', async (child, fail) => {
      child.on('invariants-test/ping', leaked, { global: true })
      await Promise.resolve()
      fail('asynchronous check failed')
    }))
    await expect(Promise.resolve(failed)).rejects.toThrow(/asynchronous check failed/)
    ctx.emit('invariants-test/ping')
    expect(leaked).not.toHaveBeenCalled()

    const retry = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-async-probe', async () => {
      await Promise.resolve()
    }))
    await retry
    await retry()
  })

  it('releases a synchronous reservation if the service fiber is already inactive', async () => {
    const { ctx, fiber } = await setup()
    const service = ctx.invariants
    await fiber.dispose()
    expect(() => service.register('@deepseek-ai/dsh-session', () => {})).toThrow(/inactive/i)
  })
})
