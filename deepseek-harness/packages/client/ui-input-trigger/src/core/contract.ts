/**
 * Frozen pure-core contract: trigger detection and
 * menu reduction, zero React / DOM / cordis. Types only — implementations
 * live in sibling modules annotated with these
 * aliases; the service shell wires them to ctx.
 */
import type { InputTriggerCandidate, TokenSpan, TriggerChar, TriggerGuard, TriggerPosition } from '../types.ts'

/** A detected trigger token under the caret. */
export interface TriggerHit {
  readonly trigger: TriggerChar
  /** Text between the trigger char and the caret, live-filtered. */
  readonly query: string
  /** leading = draft trimmed (whitespace incl. newlines) starts with the token. */
  readonly position: TriggerPosition
  /** Token span; draftRev injected by the caller. */
  readonly span: TokenSpan
}

/**
 * Detect a trigger token at the caret under the given guard tier.
 * Word-boundary rule: the char before the trigger is start-of-line,
 * whitespace, or punctuation; `user@host` and URL '/' do not trigger.
 * Returns null when no trigger is live at the caret.
 */
export type DetectTrigger = (draft: string, caret: number, guard: TriggerGuard) => TriggerHit | null

/** Menu state: one group per source; empty ready groups auto-close the menu. */
export interface MenuState {
  readonly open: boolean
  readonly hit: TriggerHit | null
  /** Monotonic per-hit generation; stale source settlements are dropped. */
  readonly generation: number
  readonly groups: readonly {
    readonly source: string
    readonly status: 'pending' | 'ready'
    readonly items: readonly InputTriggerCandidate[]
  }[]
  readonly highlight: { readonly source: string; readonly index: number } | null
}

/** Menu reduction events. Source failure = silent group removal (log only; no error UI tier). */
export type MenuEvent =
  | { readonly type: 'hit'; readonly hit: TriggerHit | null }
  | { readonly type: 'source-settled'; readonly generation: number; readonly source: string; readonly items?: readonly InputTriggerCandidate[] }
  | { readonly type: 'source-failed'; readonly generation: number; readonly source: string }
  | { readonly type: 'move'; readonly dir: 1 | -1 }
  | { readonly type: 'close' }

/** Pure menu reducer; returns the same reference when the event is stale or a no-op. */
export type MenuReduce = (state: MenuState, ev: MenuEvent) => MenuState

/**
 * Exact-name lookup in one source's ready group; null when absent or the
 * group is not ready.
 */
export type ExactMatch = (groups: MenuState['groups'], source: string, name: string) => InputTriggerCandidate | null
