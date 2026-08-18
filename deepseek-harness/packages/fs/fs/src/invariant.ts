/** Package-owned filesystem event-data invariants. @module @deepseek-ai/dsh-fs/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { FsObservation, FsTarget } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-fs'

/** Cordis companion plugin name. */
export const name = 'fs-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Assert that an event carries a usable opaque target identity. */
function validateTarget(target: FsTarget, fail: (message: string) => never): void {
  if (target.targetKey.length === 0) fail('filesystem event targetKey must be non-empty')
  if (target.displayPath.length === 0) fail('filesystem event displayPath must be non-empty')
}

/** Install checks over the filesystem decision and observation event stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'fs/write-intent'
      && eventName !== 'fs/edit-intent'
      && eventName !== 'fs/observed') return
    validateTarget(args[0] as FsTarget, fail)
    if (eventName === 'fs/observed') {
      const observation = args[1] as FsObservation
      switch (observation.kind) {
        case 'present':
          if (observation.version.length === 0) fail('fs/observed present version must be non-empty')
          break
        case 'absent':
          break
        default:
          fail('fs/observed kind must be present or absent')
      }
    }
  }, { global: true })
}

/**
 * Register the filesystem invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
