/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-cordis`.
 * @module @deepseek-ai/dsh-client-ui-cordis/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-cordis'

/** Cordis companion plugin name. */
export const name = 'client-ui-cordis-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a single keyed toolview registration whose disposal is
 * proven by the HMR-safety spec. The one mutable relation this package owns —
 * the per-definition run-state observable — lives in the browser process, out
 * of reach of the host invariant service, and the node half emits no cordis
 * events and holds no cross-plugin state.
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
