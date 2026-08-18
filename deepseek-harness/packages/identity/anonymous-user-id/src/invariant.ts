/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-anonymous-user-id`.
 * @module @deepseek-ai/dsh-anonymous-user-id/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-anonymous-user-id'

/** Cordis companion plugin name. */
export const name = 'anonymous-user-id-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the API owns one private memo and one best-effort
 * file, with no independent event stream or public mutable relation for a
 * companion to compare without creating the identity as a side effect.
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
