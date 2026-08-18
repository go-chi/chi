/**
 * Runtime mirror and labels for Cordis's `FiberState` const enum. A const enum has no runtime
 * object to import, so these values mirror the pinned vendored definition while retaining its
 * type.
 * @module @deepseek-ai/dsh-tool-cordis/fiber-state
 */

import type { FiberState as FiberStateEnum } from '@deepseek-ai/cordis'

/** Value mirror of the cordis `FiberState` const enum (see the module doc for why a mirror exists). */
export const FiberState = {
  PENDING: 0 as FiberStateEnum.PENDING,
  LOADING: 1 as FiberStateEnum.LOADING,
  ACTIVE: 2 as FiberStateEnum.ACTIVE,
  FAILED: 3 as FiberStateEnum.FAILED,
  DISPOSED: 4 as FiberStateEnum.DISPOSED,
  UNLOADING: 5 as FiberStateEnum.UNLOADING,
} as const

/** The cordis `FiberState` enum type, re-exported so mirror consumers need one import. */
export type FiberState = FiberStateEnum

/** Human-readable label for each {@link FiberState}, keyed by member (inlining-safe — no reverse mapping). */
export const STATE_LABELS = {
  [FiberState.PENDING]: 'pending',
  [FiberState.LOADING]: 'loading',
  [FiberState.ACTIVE]: 'active',
  [FiberState.FAILED]: 'failed',
  [FiberState.DISPOSED]: 'disposed',
  [FiberState.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, string>
