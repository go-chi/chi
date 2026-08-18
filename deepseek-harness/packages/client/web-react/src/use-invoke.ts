/**
 * useInvoke: wrap an async action into a stable trigger plus pending flag.
 * Pending is tracked in a per-hook external store read through uSES instead
 * of setState, keeping the render body side-effect free and the invoke
 * reference stable across renders (idempotent-hook rules).
 */
import { useRef, useSyncExternalStore } from 'react'

interface InvokeCell {
  inflight: number
  listeners: Set<() => void>
  fn: () => Promise<unknown>
  invoke: () => void
  subscribe: (fn: () => void) => () => void
  getPending: () => boolean
}

function createCell(fn: () => Promise<unknown>): InvokeCell {
  const cell: InvokeCell = {
    inflight: 0,
    listeners: new Set(),
    fn,
    invoke: () => {
      bump(cell, 1)
      cell.fn().catch((error: unknown) => {
        // Domain errors surface through the event echo (session log); the
        // framework only guarantees pending resets and leaves a trace.
        console.error('useInvoke action failed:', error)
      }).finally(() => { bump(cell, -1) })
    },
    subscribe: (listener) => {
      cell.listeners.add(listener)
      return () => { cell.listeners.delete(listener) }
    },
    getPending: () => cell.inflight > 0,
  }
  return cell
}

function bump(cell: InvokeCell, delta: number): void {
  const wasPending = cell.inflight > 0
  cell.inflight += delta
  if (wasPending !== cell.inflight > 0) {
    for (const listener of [...cell.listeners]) listener()
  }
}

/**
 * Wrap an async action into a stable invoke callback plus pending flag.
 * Concurrent invocations are counted: pending stays true until the last
 * in-flight call settles. The latest `fn` is always the one invoked.
 * @param fn - async action.
 * @returns invoke trigger and pending state.
 */
export function useInvoke(fn: () => Promise<unknown>): [invoke: () => void, pending: boolean] {
  const ref = useRef<InvokeCell | null>(null)
  ref.current ??= createCell(fn)
  const cell = ref.current
  cell.fn = fn
  const pending = useSyncExternalStore(cell.subscribe, cell.getPending)
  return [cell.invoke, pending]
}
