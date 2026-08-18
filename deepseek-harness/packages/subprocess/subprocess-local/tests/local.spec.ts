import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { basename, dirname, relative, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { childEnv } from '../src/spawn.ts'

function spec(command: string, overrides: Partial<SubprocessSpawnSpec> = {}): SubprocessSpawnSpec {
  return {
    argv: ['bash', '-c', command],
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64_000, spill: { maxBytes: 64 * 1024 * 1024 } },
      stderr: { maxBytes: 64_000, spill: { maxBytes: 64 * 1024 * 1024 } },
    },
    graceMs: 200,
    ...overrides,
  }
}

describe('LocalSubprocessRuntime', () => {
  it('places the host-exit finalizer before listeners that predate the service', async () => {
    const baseline = new Set(process.listeners('exit'))
    const prior = vi.fn()
    process.on('exit', prior)
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      const listeners = process.listeners('exit')
      const finalizer = listeners.find(candidate => !baseline.has(candidate) && candidate !== prior)
      expect(finalizer).toBeTypeOf('function')
      expect(listeners.indexOf(finalizer!)).toBeLessThan(listeners.indexOf(prior))
    } finally {
      process.off('exit', prior)
      await fiber.dispose()
    }
  })

  it('keeps the host-exit finalizer active until normal disposal reaches quiescence', async () => {
    const before = new Set(process.listeners('exit'))
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const listener = process.listeners('exit').find(candidate => !before.has(candidate))
    expect(listener).toBeTypeOf('function')

    let finishExit!: () => void
    const exited = new Promise<void>((resolve) => { finishExit = resolve })
    const terminate = vi.fn()
    const terminateForHostExit = vi.fn()
    const live = (ctx.subprocess as unknown as {
      live: Set<{
        done: Promise<{ exitCode: number; signal: null }>
        terminate(): void
        terminateForHostExit(): void
        waitForExit(): Promise<boolean>
      }>
    }).live
    live.add({
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate,
      terminateForHostExit,
      waitForExit: async () => { await exited; return true },
    })

    let disposed = false
    const disposing = fiber.dispose().then(() => { disposed = true })
    await new Promise(resolve => setImmediate(resolve))
    expect(disposed).toBe(false)
    expect(live.size).toBe(1)
    listener?.(0)
    expect(terminate).toHaveBeenCalledOnce()
    expect(terminateForHostExit).toHaveBeenCalledOnce()

    finishExit()
    await disposing
    expect(live.size).toBe(0)
    expect(process.listeners('exit')).not.toContain(listener)
  })

  it('contains each host-exit termination failure and continues with the other targets', async () => {
    const before = new Set(process.listeners('exit'))
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const listener = process.listeners('exit').find(candidate => !before.has(candidate))
    expect(listener).toBeTypeOf('function')
    const ordinaryFailure = vi.fn(() => { throw new Error('ordinary failed') })
    const ordinarySuccess = vi.fn()
    const terminalFailure = vi.fn(() => { throw new Error('terminal failed') })
    const terminalSuccess = vi.fn()
    const service = ctx.subprocess as unknown as {
      live: Set<{ terminateForHostExit(): void }>
      terminals: Set<{ terminateForHostExit(): void }>
    }
    service.live.add({ terminateForHostExit: ordinaryFailure })
    service.live.add({ terminateForHostExit: ordinarySuccess })
    service.terminals.add({ terminateForHostExit: terminalFailure })
    service.terminals.add({ terminateForHostExit: terminalSuccess })

    expect(() => { listener?.(0) }).not.toThrow()
    expect(ordinaryFailure).toHaveBeenCalledOnce()
    expect(ordinarySuccess).toHaveBeenCalledOnce()
    expect(terminalFailure).toHaveBeenCalledOnce()
    expect(terminalSuccess).toHaveBeenCalledOnce()

    service.live.clear()
    service.terminals.clear()
    await fiber.dispose()
  })

  it('resolves absolute and PATH executables and honors lookup cancellation', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    expect(await ctx.subprocess.resolveExecutable(process.execPath)).toBe(process.execPath)
    expect(await ctx.subprocess.resolveExecutable(basename(process.execPath), {
      PATH: dirname(process.execPath),
    })).toBe(process.execPath)
    expect(await ctx.subprocess.resolveExecutable(basename(process.execPath), {
      PATH: relative(process.cwd(), dirname(process.execPath)) || '.',
    })).toBe(process.execPath)
    await expect(ctx.subprocess.resolveExecutable('')).rejects.toThrow('must be non-empty')
    await expect(ctx.subprocess.resolveExecutable('./bin/tsserver'))
      .rejects.toThrow('is a relative path')
    await expect(ctx.subprocess.resolveExecutable('node_modules/.bin/server'))
      .rejects.toThrow('is a relative path')
    await expect(ctx.subprocess.resolveExecutable('dsh-command-that-does-not-exist', { PATH: '' }))
      .rejects.toThrow('was not found on PATH')
    await expect(ctx.subprocess.resolveExecutable('/dsh-absolute-command-that-does-not-exist'))
      .rejects.toThrow('is not an executable file')
    await expect(ctx.subprocess.resolveExecutable(process.cwd()))
      .rejects.toThrow('is not an executable file')
    await expect(ctx.subprocess.resolveExecutable(process.execPath, {}, AbortSignal.abort('stop')))
      .rejects.toBe('stop')
    await fiber.dispose()
  })

  it('builds Windows executable candidates with case-insensitive overrides', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const service = ctx.subprocess as LocalSubprocessRuntime
    const candidates = (service as unknown as {
      executableCandidates(command: string, env: NodeJS.ProcessEnv): string[]
    }).executableCandidates.bind(service)
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      expect(Object.keys(childEnv()).filter(key => key.toUpperCase() === 'PATH')).toHaveLength(1)
      const explicit = childEnv({ Path: '/bin', PathExt: '.EXE;.CMD' })
      expect(Object.keys(explicit).filter(key => key.toUpperCase() === 'PATH')).toEqual(['Path'])
      expect(Object.keys(explicit).filter(key => key.toUpperCase() === 'PATHEXT')).toEqual(['PathExt'])
      expect(candidates('tool', explicit)).toEqual(['/bin/tool.EXE', '/bin/tool.CMD'])
      expect(candidates('tool', { Path: '/ambient', PATH: '/explicit', PATHEXT: '.EXE' }))
        .toEqual(['/explicit/tool.EXE'])
      expect(candidates('tool.exe', {})).toEqual([resolve(process.cwd(), 'tool.exe')])
      expect(candidates('tool', { PATH: '/bin' })).toHaveLength(4)
      await expect(ctx.subprocess.resolveExecutable(String.raw`bin\server.exe`))
        .rejects.toThrow('is a relative path')
    } finally {
      platform.mockRestore()
      await fiber.dispose()
    }
  })

  it('validates terminal allocation inputs before allocating a PTY', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const base: SubprocessTerminalSpawnSpec = {
      argv: ['bash'], cwd: process.cwd(), rows: 24, cols: 80, graceMs: 10,
    }
    await expect(ctx.subprocess.spawnTerminal({ ...base, argv: [] })).rejects.toThrow('must contain a program')
    await expect(ctx.subprocess.spawnTerminal({ ...base, argv: [''] })).rejects.toThrow('must contain a program')
    await expect(ctx.subprocess.spawnTerminal({ ...base, signal: AbortSignal.abort('stop') })).rejects.toBe('stop')
    await fiber.dispose()
  })

  it('terminates and joins an owned terminal during disposal', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const terminate = vi.fn(async () => {})
    const terminal: SubprocessTerminalHandle = {
      pid: 1,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: async () => {},
      inspectForeground: async () => undefined,
      signalForeground: async () => 1,
      terminate,
    }
    const terminals = (ctx.subprocess as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals
    terminals.add(terminal)
    await fiber.dispose()
    expect(terminate).toHaveBeenCalledOnce()
    expect(terminals.size).toBe(0)
  })

  it('waits for every terminal cleanup and aggregates teardown failures', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const service = ctx.subprocess
    const firstFailure = new Error('first cleanup failure')
    const secondFailure = new Error('second cleanup failure')
    const disposalErrors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
    const failedTerminal: SubprocessTerminalHandle = {
      pid: 1,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: async () => {},
      inspectForeground: async () => undefined,
      signalForeground: async () => 1,
      terminate: vi.fn(async () => { throw firstFailure }),
    }
    const secondFailedTerminal: SubprocessTerminalHandle = {
      ...failedTerminal,
      terminate: vi.fn(async () => { throw secondFailure }),
    }
    let finishCleanup!: () => void
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve
    })
    const drainingTerminal: SubprocessTerminalHandle = {
      ...failedTerminal,
      terminate: vi.fn(() => cleanup),
    }
    const terminals = (service as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals
    terminals.add(failedTerminal)
    terminals.add(secondFailedTerminal)
    terminals.add(drainingTerminal)

    let disposed = false
    const disposing = fiber.dispose().then(() => { disposed = true })
    await new Promise(resolve => setImmediate(resolve))
    expect(disposed).toBe(false)
    finishCleanup()
    await disposing
    expect(terminals.size).toBe(0)
    expect(disposalErrors).toHaveLength(1)
    expect(disposalErrors[0]).toMatchObject({
      errors: [firstFailure, secondFailure],
      message: 'local subprocess teardown failed',
    })
  })

  it('reports one cleanup failure without wrapping it', async () => {
    const ctx = new Context()
    const failure = new Error('single cleanup failure')
    const disposalErrors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const service = ctx.subprocess
    const terminal: SubprocessTerminalHandle = {
      pid: 1,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: async () => {},
      inspectForeground: async () => undefined,
      signalForeground: async () => 1,
      terminate: vi.fn(async () => { throw failure }),
    }
    const terminals = (service as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals
    terminals.add(terminal)

    await fiber.dispose()

    expect(disposalErrors).toEqual([failure])
  })

  it('force-terminates remaining targets before releasing a failed disposal', async () => {
    const before = new Set(process.listeners('exit'))
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const listener = process.listeners('exit').find(candidate => !before.has(candidate))
    expect(listener).toBeTypeOf('function')
    const failure = new Error('cleanup failed')
    const terminateForHostExit = vi.fn(() => {
      expect(process.listeners('exit')).toContain(listener)
    })
    const terminal = {
      terminate: vi.fn(async () => { throw failure }),
      terminateForHostExit,
    }
    const terminals = (ctx.subprocess as unknown as { terminals: Set<typeof terminal> }).terminals
    terminals.add(terminal)

    await fiber.dispose()

    expect(terminateForHostExit).toHaveBeenCalledOnce()
    expect(terminals.size).toBe(0)
    expect(process.listeners('exit')).not.toContain(listener)
  })

  it('releases a terminal after top-level exit reaches quiescence', async () => {
    let exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined
    const inspector = {
      foregroundPgid: () => undefined,
      isStdinWaiting: () => false,
      processTree: () => [],
      processSession: () => [],
      isAlive: () => false,
      signalGroup: () => {},
      signalProcess: () => {},
    }
    const terminal = {
      pid: 123,
      onData: () => ({ dispose: () => {} }),
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
        exitListener = listener
        return { dispose: () => {} }
      },
      write: () => {},
      kill: () => {},
    }
    vi.resetModules()
    vi.doMock('node-pty', () => ({ spawn: () => terminal }))
    vi.doMock('../src/process-inspector.ts', async importOriginal => ({
      ...await importOriginal<typeof import('../src/process-inspector.ts')>(),
      createProcessInspector: () => inspector,
    }))
    try {
      const { default: IsolatedLocalSubprocessRuntime } = await import('../src/index.ts')
      const ctx = new Context()
      const fiber = await ctx.plugin(IsolatedLocalSubprocessRuntime)
      const service = ctx.subprocess as InstanceType<typeof IsolatedLocalSubprocessRuntime>
      const handle = await ctx.subprocess.spawnTerminal({
        argv: ['shell'], cwd: process.cwd(), rows: 24, cols: 80, graceMs: 1,
      })
      expect((service as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals.size).toBe(1)
      exitListener?.({ exitCode: 0 })
      await handle.done
      await new Promise(resolve => setImmediate(resolve))
      expect((service as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals.size).toBe(0)
      await fiber.dispose()
    } finally {
      vi.doUnmock('node-pty')
      vi.doUnmock('../src/process-inspector.ts')
      vi.resetModules()
    }
  })

  it('retains a terminal whose automatic cleanup fails', async () => {
    let exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined
    const terminal = {
      pid: 123,
      onData: () => ({ dispose: () => {} }),
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
        exitListener = listener
        return { dispose: () => {} }
      },
      write: () => {},
      kill: () => {},
    }
    vi.resetModules()
    vi.doMock('node-pty', () => ({ spawn: () => terminal }))
    try {
      const { default: IsolatedLocalSubprocessRuntime } = await import('../src/index.ts')
      const ctx = new Context()
      const disposalErrors: unknown[] = []
      ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
      const fiber = await ctx.plugin(IsolatedLocalSubprocessRuntime)
      const alive = new Set([124])
      ;(ctx.subprocess as InstanceType<typeof IsolatedLocalSubprocessRuntime>).terminalInspector = {
        foregroundPgid: () => 123,
        isStdinWaiting: () => false,
        processTree: () => [{ pid: 123, started: 'shell' }, { pid: 124, started: 'child' }],
        processSession: () => [],
        isAlive: identity => alive.has(identity.pid),
        signalGroup: () => {},
        signalProcess: () => {},
      }
      const handle = await ctx.subprocess.spawnTerminal({
        argv: ['shell'], cwd: process.cwd(), rows: 24, cols: 80, graceMs: 1,
      })
      exitListener?.({ exitCode: 0 })
      await handle.done
      await new Promise(resolve => setTimeout(resolve, 10))
      expect((ctx.subprocess as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals.size).toBe(1)
      await fiber.dispose()
      expect(disposalErrors).toHaveLength(1)
    } finally {
      vi.doUnmock('node-pty')
      vi.resetModules()
    }
  })

  it('registers as ctx.subprocess and spawns managed handles', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn(spec('echo managed'))
    const result = await handle.done
    expect(result.exitCode).toBe(0)
    expect(handle.collected.stdout!.readFrom(0).text).toBe('managed\n')
    await fiber.dispose()
  })

  it('disposal kills still-running processes and awaits their exit', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn(spec('sleep 60'))
    await fiber.dispose()
    const outcome = await handle.done
    expect(outcome.signal).toBe('SIGTERM')
  })

  it('a settled process leaves the live set (disposal does not re-kill it)', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn(spec('true'))
    const outcome = await handle.done
    expect(outcome.exitCode).toBe(0)
    await fiber.dispose()
  })

  it('disposal tolerates a handle whose spawn already failed', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn(spec('true', { cwd: '/nonexistent-dir-dsh-subprocess-test' }))
    await expect(handle.done).rejects.toThrow()
    await fiber.dispose()
  })

  it('disposal contains a spawn-failure rejection that races teardown', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    // Dispose before the rejection continuation removes the handle from the
    // live set, so teardown itself must swallow the rejected done.
    const handle = ctx.subprocess.spawn(spec('true', { cwd: '/nonexistent-dir-dsh-subprocess-test' }))
    await fiber.dispose()
    await expect(handle.done).rejects.toThrow()
  })

  it('loading a second implementation throws (one processes service per context — cordis standard)', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    class SecondManager extends LocalSubprocessRuntime {}
    await expect(ctx.plugin(SecondManager)).rejects.toThrow(/service "subprocess" has been registered/)
  })
})
