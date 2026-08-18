/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-theme`.
 * @module @deepseek-ai/dsh-client-ui-theme/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-theme'

/** Cordis companion plugin name. */
export const name = 'client-ui-theme-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the settings scope validates and publishes the durable
 * theme section, while the registry emits `theme/change` synchronously with
 * its own mutations. Store/registry agreement is covered directly by this
 * package's Host, scope, and service behavior specs.
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
