/** Package-owned subagent registry and lifecycle invariants. @module @deepseek-ai/dsh-subagent/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SubagentProvider, SubagentRunEndInfo, SubagentRunInfo } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-subagent'

/** Cordis companion plugin name. */
export const name = 'subagent-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Assert that a terminal lifecycle payload matches its start identity. */
function validateRunEnd(start: SubagentRunInfo, end: SubagentRunEndInfo, fail: InvariantFailure): void {
  if (start.provider !== end.provider || start.id !== end.id || start.local !== end.local) {
    fail(`subagent/end identity diverges from subagent/start for run ${JSON.stringify(end.runId)}`)
  }
}

/** Install provider-registry and start/end pairing checks. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const providers = new Set(ctx.subagents.list())
  const runs = new Map<string, SubagentRunInfo>()
  const stagedProviders = new WeakSet<SubagentProvider>()
  const stagedRemovals = new Set<string>()
  const stagedStarts = new WeakSet<SubagentRunInfo>()
  const stagedEnds = new WeakSet<SubagentRunEndInfo>()

  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'subagent/provider-added') {
      const provider = args[0] as SubagentProvider
      if (provider.name.length === 0) fail('subagent provider names must be non-empty')
      if (providers.has(provider.name)) fail(`subagent/provider-added repeated ${JSON.stringify(provider.name)}`)
      stagedProviders.add(provider)
      return
    }
    if (eventName === 'subagent/provider-removed') {
      const providerName = args[0] as string
      if (!providers.has(providerName)) fail(`subagent/provider-removed names unknown provider ${JSON.stringify(providerName)}`)
      stagedRemovals.add(providerName)
      return
    }
    if (eventName === 'subagent/start') {
      const info = args[0] as SubagentRunInfo
      // Provider availability is an admission-time relationship. A published
      // one-shot run may outlive provider removal, and a cold-resumed Activation
      // records the initial provider name without dispatching through it.
      if (info.provider.length === 0 || String(info.runId).length === 0 || String(info.id).length === 0) {
        fail('subagent/start provider, runId, and child id must be non-empty')
      }
      if (runs.has(info.runId)) fail(`subagent/start repeated run id ${JSON.stringify(info.runId)}`)
      stagedStarts.add(info)
      return
    }
    if (eventName !== 'subagent/end') return
    const info = args[0] as SubagentRunEndInfo
    const start = runs.get(info.runId)
    if (start === undefined) fail(`subagent/end has no matching subagent/start for run ${JSON.stringify(info.runId)}`)
    validateRunEnd(start, info, fail)
    stagedEnds.add(info)
  }, { global: true })

  ctx.on('subagent/provider-added', (provider) => {
    /* v8 ignore next -- internal/dispatch stages the same provider object */
    if (!stagedProviders.delete(provider)) return
    providers.add(provider.name)
  }, { global: true })
  ctx.on('subagent/provider-removed', (providerName) => {
    /* v8 ignore next -- internal/dispatch stages the same provider name */
    if (!stagedRemovals.delete(providerName)) return
    providers.delete(providerName)
  }, { global: true })
  ctx.on('subagent/start', (info) => {
    /* v8 ignore next -- internal/dispatch stages the same lifecycle object */
    if (!stagedStarts.delete(info)) return
    runs.set(info.runId, info)
  }, { global: true })
  ctx.on('subagent/end', (info) => {
    /* v8 ignore next -- internal/dispatch stages the same lifecycle object */
    if (!stagedEnds.delete(info)) return
    runs.delete(info.runId)
  }, { global: true })
}, { inject: ['subagents'] })

/**
 * Register the subagent invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
