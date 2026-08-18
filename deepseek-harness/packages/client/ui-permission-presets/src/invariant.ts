/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-permission-presets`.
 * @module @deepseek-ai/dsh-client-ui-permission-presets/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-permission-presets'

/** Cordis companion plugin name. */
export const name = 'client-ui-permission-presets-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the command and slot contribution lifecycles are
 * proven by the HMR-safety spec, while the browser-only Settings controller
 * owns no host events or cross-plugin mutable state.
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
