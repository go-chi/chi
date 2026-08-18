/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-frontend-static`.
 * @module @deepseek-ai/dsh-host-frontend-static/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-frontend-static'

/** Cordis companion plugin name. */
export const name = 'host-frontend-static-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the only owned relation is the single fallback seat,
 * which cannot be probed from the teardown stream — `internal/plugin` fires
 * before the disposing fiber's effects run, so the legitimate owner still
 * holds the seat at notification time and any claim probe would
 * false-positive on every correct disposal (unlike the webserver companion,
 * whose reserved-path probes never collide with a live registration). The
 * seat's register/release symmetry is covered by the package's
 * real-composition HMR-safety test instead.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
