/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-token-meter`.
 * @module @deepseek-ai/dsh-token-meter/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-token-meter'

/** Cordis companion plugin name. */
export const name = 'token-meter-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: token estimates are per-call outputs and the private
 * session cache is invalidated at its event mutation boundary. The package's
 * three projections do expose observation streams, but their schemas fix the
 * JSON payloads; the usage folds replace same-step samples, so totals need not
 * be monotone when a final sample corrects an earlier chunk, and the
 * composition fold prices through the same `estimate.ts` heuristic as the
 * measurement service and subtracts producer-logged shadow prices derived
 * from that service's own nodes, which makes its message figure equal
 * `measure().surfaceTokens` by construction rather than by a relation worth
 * observing at runtime.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
