/**
 * The measurement service's positional surface fold: the per-node priced
 * surface `measure()` serves and compaction plans against. The projection
 * units deliberately do NOT share this fold — their state must stay O(1)
 * for the persisted checkpoint, so they ride `surface-projection.ts`'s
 * shadow-price protocol instead. Fully metered logs stay in agreement by
 * construction: both price through `estimate.ts`, and every logged shadow
 * price is derived from THIS fold's nodes by the replace producer. A
 * projection replacement without a claim deliberately folds with zero delta.
 *
 * @module @deepseek-ai/dsh-token-meter/surface-fold
 */

import { deriveEventMessage } from '@deepseek-ai/dsh-session'
import type { SurfaceEvent } from '@deepseek-ai/dsh-session'
import type { TokenSurfaceNode } from './types.ts'
import { estimateMessage } from './estimate.ts'

/** One surface event's placement and cost against the surface preceding it. */
export interface SurfaceTokenFold {
  /** Heuristic price of the event's own message; 0 when it derives none. */
  readonly tokens: number
  /** The surface after the event, detached from the input. */
  readonly nodes: TokenSurfaceNode[]
  /** Signed change in the surface total: `tokens` minus anything shadowed. */
  readonly deltaTokens: number
}

/**
 * Fold one surface event onto a priced surface.
 *
 * Total and allocation-fresh: the caller assigns the result rather than
 * mutating in place, so a throw here leaves the caller's state untouched and
 * the same malformed event fails identically on every retry.
 * @param nodes - the priced surface preceding this event, in model-visible order.
 * @param event - the surface event to place.
 * @returns the event's price, the next surface, and the signed total delta.
 * @throws when a replacement names a range absent from `nodes` — committed
 *   logs are surface-validated at append time, so an unresolvable range is log
 *   corruption and must fail loud rather than skip the event.
 */
export function foldSurfaceTokens(
  nodes: readonly TokenSurfaceNode[],
  event: SurfaceEvent,
): SurfaceTokenFold {
  const message = deriveEventMessage(event)
  const tokens = message === null ? 0 : estimateMessage(message)
  const op = event.surfaceOp
  if (op === 'append') {
    return { tokens, nodes: [...nodes, { seq: event.seq, tokens }], deltaTokens: tokens }
  }
  const startIdx = nodes.findIndex(node => node.seq === op.start)
  const endIdx = nodes.findIndex(node => node.seq === op.end)
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    throw new Error(
      `token surface: replace at seq ${event.seq} has invalid current range ${op.start}-${op.end}`,
    )
  }
  const removed = nodes
    .slice(startIdx, endIdx + 1)
    .reduce((total, node) => total + node.tokens, 0)
  const next = [...nodes]
  next.splice(startIdx, endIdx - startIdx + 1, { seq: event.seq, tokens })
  return { tokens, nodes: next, deltaTokens: tokens - removed }
}
