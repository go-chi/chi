/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-slots`.
 * @module @deepseek-ai/dsh-client-ui-slots/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-slots'

/** Cordis companion plugin name. */
export const name = 'client-ui-slots-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a zero-dependency pure registry core — it emits no
 * cordis events itself (the runtime SlotRegistry wrapper owns the event
 * bridge and its invariants); define/register/dispose sequencing is asserted
 * directly by this package's behavior specs.
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
