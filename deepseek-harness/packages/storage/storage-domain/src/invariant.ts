/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-storage-domain`: every
 * `domain/changed` event must agree with the emitting domain's authoritative
 * in-memory state (the owned event-stream ↔ mutable-data relationship of this
 * package). Writes emit strictly after mutating memory and the write chain
 * serializes them, so at emission time the event's snapshot equals the
 * current read — any divergence means a write path skipped the chain or
 * emitted a stale value.
 * @module @deepseek-ai/dsh-storage-domain/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from './events.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-storage-domain'

/** Cordis companion plugin name. */
export const name = 'storage-domain-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Install the change-event ↔ memory-state agreement check. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('domain/changed', (change: DomainChanged) => {
    const domain = ctx.storage.form('domain').get(change.domain)
    if (domain === undefined) {
      return fail(`domain/changed for '${change.domain}' emitted while that domain is not open`)
    }
    if (change.table === '') {
      // Global write: the event snapshot must be the current global value.
      if (domain.global.get() !== change.value) {
        return fail(`domain/changed global value for '${change.domain}' differs from the in-memory global`)
      }
      return
    }
    const current = domain.table(change.table).get(change.key)
    switch (change.operation) {
      case 'deleted':
        if (current !== undefined) {
          return fail(
            `domain/changed deletion of '${change.domain}'.'${change.table}'['${change.key}'] `
            + 'emitted while the record is still in memory',
          )
        }
        return
      case 'put':
        if (current !== change.value) {
          return fail(
            `domain/changed value for '${change.domain}'.'${change.table}'['${change.key}'] `
            + 'differs from the in-memory record',
          )
        }
        return
      default:
        change satisfies never
    }
  }, { global: true })
}, { inject: ['storage'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
