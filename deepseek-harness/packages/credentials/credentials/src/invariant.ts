/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-credentials`.
 * @module @deepseek-ai/dsh-credentials/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-credentials'

/** Cordis companion plugin name. */
export const name = 'credentials-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Install the commit-event lifecycle contract: `credentials/updated` names a
 * committed provider-source change, so it can only fire while a credentials
 * service is live — an emission after disposal means a provider leaked work
 * past its teardown quiescence. The value relation itself (`describe`
 * agreeing with `resolve`) is asynchronous provider I/O and stays pinned by
 * each provider's own suite.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('credentials/updated', (ref) => {
    if (ctx.get('credentials') === undefined) {
      fail(`credentials/updated for "${ref}" emitted without a live credentials service`)
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
