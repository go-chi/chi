// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useInvoke } from '@deepseek-ai/dsh-client-web-react'

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

interface Probe {
  invoke: () => void
  pending: boolean
  renders: number
}

function Harness({ fn, probe }: { fn: () => Promise<unknown>; probe: Probe }) {
  const [invoke, pending] = useInvoke(fn)
  probe.invoke = invoke
  probe.pending = pending
  probe.renders += 1
  return null
}

const newProbe = (): Probe => ({ invoke: () => {}, pending: false, renders: 0 })

describe('useInvoke', () => {
  it('tracks pending across the action lifecycle', async () => {
    const d = deferred()
    const probe = newProbe()
    render(<Harness fn={() => d.promise} probe={probe} />)
    expect(probe.pending).toBe(false)
    act(() => { probe.invoke() })
    expect(probe.pending).toBe(true)
    await act(async () => { d.resolve(); await d.promise })
    expect(probe.pending).toBe(false)
  })

  it('keeps pending true until the last concurrent call settles', async () => {
    const d1 = deferred()
    const d2 = deferred()
    const queue = [d1, d2]
    const probe = newProbe()
    render(<Harness fn={() => queue.shift()!.promise} probe={probe} />)
    act(() => { probe.invoke() })
    act(() => { probe.invoke() })
    expect(probe.pending).toBe(true)
    await act(async () => { d1.resolve(); await d1.promise })
    expect(probe.pending).toBe(true)
    await act(async () => { d2.resolve(); await d2.promise })
    expect(probe.pending).toBe(false)
  })

  it('keeps the invoke reference stable while fn changes, and calls the latest fn', async () => {
    const first = vi.fn(() => Promise.resolve())
    const second = vi.fn(() => Promise.resolve())
    const probe = newProbe()
    const { rerender } = render(<Harness fn={first} probe={probe} />)
    const invokeBefore = probe.invoke
    rerender(<Harness fn={second} probe={probe} />)
    expect(probe.invoke).toBe(invokeBefore)
    await act(async () => { probe.invoke() })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('resets pending and logs when the action rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deferred()
    const probe = newProbe()
    render(<Harness fn={() => d.promise} probe={probe} />)
    act(() => { probe.invoke() })
    expect(probe.pending).toBe(true)
    await act(async () => {
      d.reject(new Error('boom'))
      await d.promise.catch(() => {})
    })
    expect(probe.pending).toBe(false)
    expect(consoleError).toHaveBeenCalledWith('useInvoke action failed:', expect.any(Error))
    consoleError.mockRestore()
  })
})
