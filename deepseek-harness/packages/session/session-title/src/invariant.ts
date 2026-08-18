/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-title`.
 * @module @deepseek-ai/dsh-session-title/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-title'

/** Cordis companion plugin name. */
export const name = 'session-title-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Durable title-source invariant: an automatic title always cites at
 * least one human `user/message` seq, and an explicit user rename cites none
 * — `messageSeqs` is empty iff `source.kind` is `user`. Provider revisions
 * are validated by the service before their append; this checks the durable
 * relationship every appended `session/title` event must keep, whichever
 * writer produced it.
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  // internal/dispatch interception rejects the append before publication
  // (the session/event listener would only observe the already-committed log).
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [unknown, SessionEvent]
    if (event.type !== 'session/title') return
    const { source, messageSeqs } = event.data
    if ((messageSeqs.length === 0) !== (source.kind === 'user')) {
      const requirement = source.kind === 'user' ? 'cite no message seqs' : 'cite at least one message seq'
      fail(`session/title event ${String(event.seq)} with source "${source.kind}" must ${requirement}; got ${String(messageSeqs.length)}`)
    }
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
