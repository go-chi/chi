/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-subagent-dsh-sdk`.
 * @module @deepseek-ai/dsh-subagent-dsh-sdk/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-subagent-dsh-sdk'

/** Cordis companion plugin name. */
export const name = 'subagent-dsh-sdk-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: run lifecycle pairing is owned and checked by the
 * subagent seam's invariant; this backend's own state lives in the child
 * process beyond this context's event streams.
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
