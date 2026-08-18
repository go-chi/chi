/** Deterministic provider adapter for the headless retry-policy snapshot. */

import {
  LlmAdapter,
  LlmError,
  resolveRetryPolicy,
} from '@deepseek-ai/dsh-llm'

class RetrySnapshotAdapter extends LlmAdapter {
  requests = 0
  firstMessages
  policy = resolveRetryPolicy({
    mode: 'normal',
    maxRetries: 1,
    retryableCodes: ['RATE_LIMIT'],
    backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
  }, 'retry-snapshot-backend.retryPolicy')

  providerRetryPolicy() {
    return this.policy
  }

  async * stream(options) {
    const messages = JSON.stringify(options.messages)
    this.requests++
    if (this.requests === 1) {
      this.firstMessages = messages
      throw new LlmError('snapshot transient failure', 'RATE_LIMIT', { status: 429 })
    }
    if (this.requests === 2 && messages !== this.firstMessages) {
      throw new Error('retry snapshot changed the model-visible messages')
    }
    const text = 'RETRY_OK'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Cordis plugin name. */
export const name = 'retry-snapshot-backend'
/** Required LLM registry service. */
export const inject = ['llm']

/**
 * Register the deterministic provider adapter.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context carrying the LLM service.
 */
export function apply(ctx) {
  ctx.llm.registerAdapter(['deepseek-official'], new RetrySnapshotAdapter())
}
