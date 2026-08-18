/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-invariants`.
 * @module @deepseek-ai/dsh-invariants/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
export const name = 'invariants-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: registration ownership and child lifecycle are the service's mutation
 * boundary itself; observing them from the same registry would only duplicate its implementation.
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
