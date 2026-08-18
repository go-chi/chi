/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-web-react`.
 * @module @deepseek-ai/dsh-client-web-react/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-web-react'

/** Cordis companion plugin name. */
export const name = 'client-web-react-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: pure ctx-to-React glue — it emits no cordis events
 * and owns no cross-plugin mutable relation; store batching, selector
 * equality short-circuits, and inject-cache identity are asserted directly
 * by this package's behavior specs.
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
