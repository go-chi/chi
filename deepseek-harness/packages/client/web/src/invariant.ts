/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-web`.
 * @module @deepseek-ai/dsh-client-web/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-web'

/** Cordis companion plugin name. */
export const name = 'client-web-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the vite entry shell — boot glue and module-table
 * seeding with no cordis events and no cross-plugin mutable state; the boot
 * chain (loading page → settled → one-flip UI) is asserted by the web smoke
 * e2e against the real carrier.
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
