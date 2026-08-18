/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-hmr`.
 * @module @deepseek-ai/dsh-client-hmr/invariant
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-hmr'

/** Cordis companion plugin name. */
export const name = 'client-hmr-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Live fs.watchFile pollers (this package is the composition's only stat-poll user). */
function statWatchers(): number {
  return process.getActiveResourcesInfo().filter(kind => kind === 'StatWatcher').length
}

/**
 * Owned relation: every bundle stat watcher the node half starts must die
 * with its fiber — a surviving poller would keep re-hashing bundles for a
 * torn-down dev chain forever. Checked as a baseline delta: the StatWatcher
 * count observed at fiber creation must be restored once disposal has drained
 * the fiber's effects (`internal/plugin` fires at dispose start; the microtask
 * hop lets the disposer queue its unload before `fiber.await()` joins it).
 * SSE-connection and listener teardown live inside the same ctx.effect
 * disposers, so the watcher count is the relation's observable proxy.
 */
const install: InvariantInstaller = (ctx, fail) => {
  const baselines = new WeakMap<Fiber, number>()
  // Async listener by design: emitPluginDisposed awaits-and-logs returned
  // promises, so a violation surfaces loudly instead of unhandled.
  // oxlint-disable-next-line typescript/no-misused-promises
  ctx.on('internal/plugin', async (fiber) => {
    if (fiber.name !== 'client-hmr') return
    if (fiber.uid !== null) {
      baselines.set(fiber, statWatchers())
      return
    }
    const baseline = baselines.get(fiber)
    if (baseline === undefined) return
    await Promise.resolve()
    await fiber.await()
    const remaining = statWatchers()
    if (remaining > baseline) {
      fail(`client-hmr fiber disposed but ${remaining - baseline} bundle stat watcher(s) survived teardown`)
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
