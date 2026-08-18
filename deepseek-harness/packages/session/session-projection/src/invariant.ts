/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-projection`.
 * @module @deepseek-ai/dsh-session-projection/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-projection'

/** Cordis companion plugin name. */
export const name = 'session-projection-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the registry's own contracts (duplicate-key and
 * stateVersion rejection, effect-tied removal, the Object.is change gate) are
 * enforced synchronously inside the service and proven by its spec, the
 * drive relation (every committed `session/event` passes every unit) would
 * require re-running the drive to check — duplicating the implementation
 * rather than detecting drift — and the served-value relation (every served
 * key has a live registration) lives on each carrier's wire path, which
 * emits no cordis event this companion could observe; carrier specs assert
 * it. Synchronous-unit discipline is enforced as far as practical by the
 * boundary `schema.parse` (a Promise-returning view fails loudly).
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
