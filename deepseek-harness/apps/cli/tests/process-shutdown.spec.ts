import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProcessShutdown,
  PROCESS_SHUTDOWN_TIMEOUT_MS,
} from '../src/process-shutdown.ts'

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('process shutdown', () => {
  it('completes naturally after disposal resolves and forces exit when it rejects', async () => {
    const resolvedExit = vi.fn()
    const resolvedComplete = vi.fn()
    const resolved = createProcessShutdown(() => Promise.resolve(), resolvedExit, resolvedComplete)
    await resolved.shutdown(0)
    expect(resolvedComplete).toHaveBeenCalledOnce()
    expect(resolvedComplete).toHaveBeenCalledWith(0)
    expect(resolvedExit).not.toHaveBeenCalled()

    const rejectedExit = vi.fn()
    const rejectedComplete = vi.fn()
    const rejected = createProcessShutdown(
      () => Promise.reject(new Error('dispose failed')),
      rejectedExit,
      rejectedComplete,
    )
    await rejected.shutdown(1)
    expect(rejectedExit).toHaveBeenCalledOnce()
    expect(rejectedExit).toHaveBeenCalledWith(1)
    expect(rejectedComplete).not.toHaveBeenCalled()
  })

  it('uses process.exitCode for default normal completion', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(_code => undefined as never)
    const originalExitCode = process.exitCode
    process.exitCode = undefined
    const shutdown = createProcessShutdown(() => Promise.resolve())

    try {
      await shutdown.shutdown(7)

      expect(process.exitCode).toBe(7)
      expect(exit).not.toHaveBeenCalled()
    } finally {
      process.exitCode = originalExitCode
    }
  })

  it('forces exit when graceful disposal reaches its bound', async () => {
    vi.useFakeTimers()
    const disposal = deferred()
    const exit = vi.fn()
    const complete = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit, complete)
    const pending = shutdown.shutdown(0)

    await vi.advanceTimersByTimeAsync(PROCESS_SHUTDOWN_TIMEOUT_MS - 1)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)

    disposal.resolve()
    await pending
    expect(exit).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
  })

  it('honors a caller-supplied grace period', async () => {
    vi.useFakeTimers()
    const disposal = deferred()
    const exit = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit, vi.fn(), 25)
    const pending = shutdown.shutdown(0)

    await vi.advanceTimersByTimeAsync(24)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(exit).toHaveBeenCalledOnce()

    disposal.resolve()
    await pending
  })

  it('lets Ctrl+C force a normal shutdown already stuck in disposal', async () => {
    const disposal = deferred()
    const exit = vi.fn()
    const complete = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit, complete)
    const pending = shutdown.shutdown(0)

    shutdown.interrupt(130)
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(130)

    disposal.resolve()
    await pending
    expect(exit).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
  })

  it('forces exit after disposal started by a signal', async () => {
    const disposal = deferred()
    const exit = vi.fn()
    const complete = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit, complete)

    shutdown.interrupt(143)
    disposal.resolve()
    await shutdown.shutdown(0)

    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(143)
    expect(complete).not.toHaveBeenCalled()
  })

  it('drains on the first signal and forces on the second signal', async () => {
    const disposal = deferred()
    const dispose = vi.fn(() => disposal.promise)
    const exit = vi.fn()
    const shutdown = createProcessShutdown(dispose, exit, vi.fn())

    shutdown.interrupt(143)
    await Promise.resolve()
    expect(dispose).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()

    shutdown.interrupt(130)
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(130)

    disposal.resolve()
    await shutdown.shutdown(0)
    expect(exit).toHaveBeenCalledOnce()
  })

  it('coalesces normal shutdown calls without treating them as escalation', async () => {
    const disposal = deferred()
    const exit = vi.fn()
    const complete = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit, complete)

    const first = shutdown.shutdown(0)
    const second = shutdown.shutdown(1)
    expect(second).toBe(first)
    expect(exit).not.toHaveBeenCalled()

    disposal.resolve()
    await first
    expect(complete).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith(0)
    expect(exit).not.toHaveBeenCalled()
  })

  it('lets a signal force exit while natural completion drains remaining handles', async () => {
    const exit = vi.fn()
    const complete = vi.fn()
    const shutdown = createProcessShutdown(() => Promise.resolve(), exit, complete)

    await shutdown.shutdown(0)
    shutdown.interrupt(130)

    expect(complete).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(130)
  })
})
