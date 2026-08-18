/** Package-owned LLM stream-protocol invariants. @module @deepseek-ai/dsh-llm/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ContentBlockType, StreamChunk } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm'

/** Cordis companion plugin name. */
export const name = 'llm-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Require one chunk index to be a non-negative safe integer. */
function validateIndex(index: number, fail: InvariantFailure): void {
  if (!Number.isSafeInteger(index) || index < 0) {
    fail(`LLM stream block index must be a non-negative safe integer, got ${index}`)
  }
}

/** Require a delta to address an open block of its matching type. */
function validateDelta(
  open: ReadonlyMap<number, ContentBlockType>,
  index: number,
  expected: ContentBlockType,
  fail: InvariantFailure,
): void {
  validateIndex(index, fail)
  const actual = open.get(index)
  if (actual !== expected) {
    fail(`${expected} delta at index ${index} requires an open ${expected} block, got ${String(actual)}`)
  }
}

/** Wrap one provider stream and enforce its grammar as chunks are consumed. */
async function* validateStream(
  source: AsyncIterable<StreamChunk>,
  fail: InvariantFailure,
): AsyncIterable<StreamChunk> {
  const open = new Map<number, ContentBlockType>()
  let usageSeen = false
  let finished = false
  for await (const chunk of source) {
    if (finished) fail(`LLM stream emitted ${chunk.type} after terminal finish`)
    switch (chunk.type) {
      case 'block-start':
        validateIndex(chunk.index, fail)
        if (open.has(chunk.index)) fail(`LLM stream repeated block-start index ${chunk.index}`)
        open.set(chunk.index, chunk.blockType)
        break
      case 'text-delta':
        validateDelta(open, chunk.index, 'text', fail)
        break
      case 'reasoning-delta':
        validateDelta(open, chunk.index, 'reasoning', fail)
        break
      case 'tool-call-delta':
        validateDelta(open, chunk.index, 'tool-call', fail)
        break
      case 'block-end': {
        validateIndex(chunk.index, fail)
        const blockType = open.get(chunk.index)
        if (blockType === undefined) fail(`LLM stream block-end index ${chunk.index} has no open block`)
        if (chunk.block.type !== blockType) {
          fail(`LLM stream block-end index ${chunk.index} closes ${chunk.block.type}, expected ${blockType}`)
        }
        open.delete(chunk.index)
        break
      }
      case 'usage':
        if (usageSeen) fail('LLM stream emitted usage more than once')
        usageSeen = true
        break
      case 'finish':
        if (open.size > 0 && chunk.reason.kind !== 'error' && chunk.reason.kind !== 'aborted') {
          fail(`LLM stream finished with ${open.size} open block(s)`)
        }
        finished = true
        break
    }
    yield chunk
  }
  if (!finished) fail('LLM stream ended without a terminal finish chunk')
}

/** Install validation around every provider stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('llm/stream', (_options, next) => validateStream(next(), fail), { global: true, prepend: true })
  ctx.on('llm/adapters-updated', () => {
    // A disposer-time emit can outlive the service-store entry during whole-
    // context teardown; only a live service promises a readable registry.
    const llm = ctx.get('llm')
    if (llm === undefined) return
    for (const provider of llm.listProviders()) {
      try {
        llm.providerRetryPolicy(provider.id)
      } catch {
        // Reaching here IS the violation: the notification promised a readable
        // registry, and only that broken promise can make the lookup throw.
        fail(`llm/adapters-updated fired while provider "${provider.id}" has no readable registration`)
      }
    }
  }, { global: true })
}

/**
 * Register the LLM invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
