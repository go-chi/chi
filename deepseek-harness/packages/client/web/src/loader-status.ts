/**
 * Fiber-state projection vocabulary and the kernel-owned status store for the
 * boot loading page. The status AppRoot renders is a projection of the real
 * cordis fiber states (display the truth, not a retelling) — the boot chain
 * subscribes `internal/status` and recomputes one row per loader entry.
 *
 * The store is hand-rolled here because of the shell self-sufficiency rule:
 * the snapshot-store machinery lives in the runtime PLUGIN
 * package, and the shell kernel must not value-import any plugin package —
 * the loading page has to work while (and especially when) plugins fail.
 * @module @deepseek-ai/dsh-client-web/src/loader-status
 */
import type { FiberState } from '@deepseek-ai/cordis'

/**
 * Value mirror of cordis's `FiberState` const enum: a const enum has no
 * runtime object to import (and esbuild-based pipelines cannot inline it
 * across modules), so these values mirror the pinned vendored definition
 * while retaining its type (same rationale as dsh-tool-cordis's mirror).
 */
export const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** One entry's projected state label (lower-case face of {@link FiberState}). */
export type LoaderEntryState = 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading'

/** Label for each fiber state, keyed by member (inlining-safe — no reverse mapping). */
export const STATE_LABELS: Record<FiberState, LoaderEntryState> = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: 'disposed',
  [FIBER_STATE.UNLOADING]: 'unloading',
}

/** Per-entry state projection (AppRoot's status feed), keyed by entry name. */
export type LoaderStatus = Record<string, LoaderEntryState>

/** Minimal observable snapshot the kernel components consume (useSyncExternalStore shape). */
export interface KernelSignal<T> {
  /** Current value (stable reference between changes). */
  getSnapshot: () => T
  /**
   * Subscribe to changes.
   * @param fn - change listener.
   * @returns the unsubscribe disposer.
   */
  subscribe: (fn: () => void) => () => void
}

/** Writable one-value signal (settled flag, boot failure report). */
export interface KernelValueSignal<T> extends KernelSignal<T> {
  /**
   * Publish a new value and notify subscribers.
   * @param next - the new value.
   */
  set: (next: T) => void
}

/**
 * Create a writable kernel signal.
 * @param init - initial value.
 * @returns the signal.
 */
export function createSignal<T>(init: T): KernelValueSignal<T> {
  let value = init
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    set: (next) => {
      value = next
      for (const fn of [...listeners]) fn()
    },
  }
}

/** The boot status store: per-entry rows over a {@link KernelSignal} face. */
export interface LoaderStatusStore extends KernelSignal<LoaderStatus> {
  /**
   * Project one entry's state (copy-on-write so getSnapshot references only
   * change on writes — useSyncExternalStore contract).
   * @param id - entry name.
   * @param state - projected fiber state.
   */
  set: (id: string, state: LoaderEntryState) => void
}

/**
 * Create the boot status store.
 * @returns the store (empty until the boot chain projects rows).
 */
export function createLoaderStatusStore(): LoaderStatusStore {
  let value: LoaderStatus = {}
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    set: (id, state) => {
      value = { ...value, [id]: state }
      for (const fn of [...listeners]) fn()
    },
  }
}
