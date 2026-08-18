/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-telemetry`.
 * @module @deepseek-ai/dsh-session-telemetry/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-telemetry'

/** Cordis companion plugin name. */
export const name = 'session-telemetry-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package's whole output is the backend handoff — a
 * synchronous `emit()` call outside every authoritative event stream — and its
 * capture side never appends session events, so no event/data relation exists
 * for an independent companion to observe.
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
