/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-apiproxy`.
 * @module @deepseek-ai/dsh-host-apiproxy/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-apiproxy'

/** Cordis companion plugin name. */
export const name = 'host-apiproxy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is the wire contract layer plus the
 * host-side gateway over services owned elsewhere — it emits no cordis events
 * of its own; the session/agent event streams it projects are asserted by
 * their owning packages' companions. rpcId round-trip and schema acceptance
 * are enforced at the carrier boundary and exercised by the
 * protocol-isomorphism suite.
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
