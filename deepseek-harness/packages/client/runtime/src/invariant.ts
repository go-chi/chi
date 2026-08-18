/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-runtime`.
 * @module @deepseek-ai/dsh-client-runtime/invariant
 */

/* jscpd:ignore-start */
/* oxlint-disable typescript/no-redundant-type-constituents --
 * `keyof SlotMap & string` is the declare-merge key pattern: SlotMap is empty
 * in this compilation unit (intersection reads `never`) but consumers merge
 * keys in; the rule fires on the empty-map view, not on real redundancy. */
import type { Context } from '@deepseek-ai/cordis'
import type { SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-runtime'

/** Cordis companion plugin name. */
export const name = 'client-runtime-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * Owned relation: every 'slots/changed'(key) emission must observe the
 * mutation already applied — SlotCore bumps the key's version synchronously
 * before the service re-emits, so a zero version at dispatch time means the
 * event fired without (or ahead of) its mutation.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'slots/changed') return
    const key: unknown = args[0]
    if (typeof key !== 'string' || key === '') {
      fail("'slots/changed' dispatched without a slot key argument")
      return
    }
    const slots = ctx.get('slots')
    // Event payloads carry keys as plain strings; getVersion is statically
    // keyed, so restore the SlotMap-key type after the runtime string check.
    if (slots !== undefined && slots.getVersion(key as keyof SlotMap & string) === 0) {
      fail(`'slots/changed' fired for "${key}" before any mutation bumped its version — emission must follow the applied mutation`)
    }
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
