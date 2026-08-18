/**
 * Notifier: microtask/frame batching, rebuild-before-notify ordering,
 * no-listener laziness, synchronous notifyNow, and unsubscribe.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Notifier } from '../src/client/sessions/notifier.ts'

const microtask = (): Promise<void> => new Promise((resolve) => { queueMicrotask(resolve) })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Notifier', () => {
  it('collapses N markDirty calls into one flush, rebuilding before notifying', async () => {
    const order: string[] = []
    const notifier = new Notifier(() => order.push('rebuild'))
    notifier.subscribe(() => order.push('notify'))
    notifier.markDirty()
    notifier.markDirty()
    notifier.markDirty()
    expect(order).toEqual([]) // nothing until the microtask boundary
    await microtask()
    expect(order).toEqual(['rebuild', 'notify'])
  })

  it('skips rebuild with zero listeners and ensureFresh rebuilds lazily exactly once', async () => {
    let rebuilds = 0
    const notifier = new Notifier(() => { rebuilds++ })
    notifier.markDirty()
    await microtask()
    expect(rebuilds).toBe(0) // lazy: kept dirty
    notifier.ensureFresh()
    expect(rebuilds).toBe(1)
    notifier.ensureFresh()
    expect(rebuilds).toBe(1) // clean: no second rebuild
  })

  it('notifyNow runs listeners synchronously (controlled-input contract)', () => {
    const order: string[] = []
    const notifier = new Notifier(() => order.push('rebuild'))
    notifier.subscribe(() => order.push('notify'))
    notifier.notifyNow()
    expect(order).toEqual(['rebuild', 'notify']) // before returning, no microtask needed
  })

  it('notifyNow with zero listeners stays lazy like markDirty', () => {
    let rebuilds = 0
    const notifier = new Notifier(() => { rebuilds++ })
    notifier.notifyNow()
    expect(rebuilds).toBe(0)
    notifier.ensureFresh()
    expect(rebuilds).toBe(1)
  })

  it('a scheduled flush after notifyNow already flushed is a no-op', async () => {
    let rebuilds = 0
    const notifier = new Notifier(() => { rebuilds++ })
    notifier.subscribe(() => undefined)
    notifier.markDirty() // schedules the microtask flush
    notifier.notifyNow() // flushes synchronously, clears dirty
    await microtask() // the scheduled flush finds dirty=false
    expect(rebuilds).toBe(1)
  })

  it('collapses frame-dirty changes into one cumulative frame publication', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const order: string[] = []
    const notifier = new Notifier(() => order.push('rebuild'))
    notifier.subscribe(() => order.push('notify'))

    notifier.markFrameDirty()
    notifier.markFrameDirty()
    notifier.markFrameDirty()

    expect(order).toEqual([])
    expect(frames).toHaveLength(1)
    frames.shift()!(0)
    expect(order).toEqual(['rebuild', 'notify'])
  })

  it('lets a structural microtask publication supersede a pending frame', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    let notifications = 0
    const notifier = new Notifier(() => undefined)
    notifier.subscribe(() => { notifications++ })

    notifier.markFrameDirty()
    notifier.markDirty()
    await microtask()
    expect(notifications).toBe(1)

    frames.shift()!(0)
    expect(notifications).toBe(1)
  })

  it('falls back to microtask batching when animation frames are unavailable', async () => {
    let notifications = 0
    const notifier = new Notifier(() => undefined)
    notifier.subscribe(() => { notifications++ })

    notifier.markFrameDirty()
    notifier.markFrameDirty()
    expect(notifications).toBe(0)
    await microtask()
    expect(notifications).toBe(1)
  })

  it('unsubscribed listeners stop receiving notifications', async () => {
    let calls = 0
    const notifier = new Notifier(() => undefined)
    const unsubscribe = notifier.subscribe(() => { calls++ })
    notifier.notifyNow()
    expect(calls).toBe(1)
    unsubscribe()
    notifier.markDirty()
    await microtask()
    notifier.notifyNow()
    expect(calls).toBe(1)
  })
})
