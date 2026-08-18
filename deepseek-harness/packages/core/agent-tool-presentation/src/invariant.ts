/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-agent-tool-presentation`.
 * @module @deepseek-ai/dsh-agent-tool-presentation/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent-tool-presentation'

/** Cordis companion plugin name. */
export const name = 'tool-presentation-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package makes exactly one scoped call into
 * `ctx.tools` and owns no event or snapshot of its own; the relation it
 * establishes — which presentation one agent's assembly uses — is the tool
 * registry's to hold, and `dsh-tools` observes it there.
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
