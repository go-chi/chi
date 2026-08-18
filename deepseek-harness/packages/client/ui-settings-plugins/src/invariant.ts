/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-settings-plugins`.
 * @module @deepseek-ai/dsh-client-ui-settings-plugins/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-plugins'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-plugins-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this is a browser-side settings surface whose node half owns no event
 * stream or mutable runtime data; the layering and write refusals are Host contracts covered by
 * the owning plugins and the api-proxy.
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
