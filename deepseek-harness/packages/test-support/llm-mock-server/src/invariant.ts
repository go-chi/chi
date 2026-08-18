/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-mock-server`.
 * @module @deepseek-ai/dsh-llm-mock-server/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-mock-server'

/** Cordis companion plugin name. */
export const name = 'llm-mock-server-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this standalone test server owns no Cordis event stream or shared data;
 * its wire behavior and lifecycle are exercised through direct HTTP and assembled-loop tests.
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
