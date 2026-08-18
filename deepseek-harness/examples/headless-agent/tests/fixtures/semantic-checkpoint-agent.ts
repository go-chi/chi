/**
 * Loader fixture that publishes the semantic-checkpoint session before CLI dispatch.
 * @module semantic-checkpoint-agent
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Fixture plugin name. */
export const name = 'semantic-checkpoint-agent'
/** Services that must exist before the fixture resumes its agent. */
export const inject = ['agents', 'agentLoop', 'sessionPersistence']

/**
 * Resume the seeded session and bind its exact handle to this fixture's lifetime.
 * @param ctx - settled agent and persistence services from the Loader tree.
 * @returns after the resumed agent is published.
 */
export async function apply(ctx: Context): Promise<void> {
  const handle = await ctx.agents.resume({
    resumeSessionId: 'semantic-checkpoint-unknown-outcome' as SessionId,
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
  ctx.effect(() => () => handle.dispose(), 'semantic-checkpoint-agent.handle')
}
