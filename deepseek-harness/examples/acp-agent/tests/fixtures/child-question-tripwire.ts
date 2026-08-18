import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-user-questions'

/** Snapshot-only provider whose invocation means the child guard failed. */
export const name = 'child-question-tripwire'

/** User-interaction service required by the tripwire provider. */
export const inject = ['userQuestions']

/** Register a provider that must remain unreachable for the delegated call. */
export function apply(ctx: Context): void {
  ctx.userQuestions.registerProvider({
    async ask() {
      throw new Error('snapshot tripwire: delegated question reached the UI provider')
    },
  })
}
