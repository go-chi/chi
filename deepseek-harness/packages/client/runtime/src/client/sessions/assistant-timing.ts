// Shared assistant step-timing fold: Chat Definitions and the Trajectory
// history fold derive AssistantTiming from the same step/start -> first token
// delta -> assistant/message sequence.

import { isTokenDelta } from '@deepseek-ai/dsh-llm/message'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { AssistantTiming } from './conversation.ts'

// The first-token predicate lives beside the StreamChunk type in dsh-llm;
// re-exported here so Chat Definitions keep their client-runtime import.
export { isTokenDelta } from '@deepseek-ai/dsh-llm/message'

/** Pre-finalize timing boundaries for one assistant step (start + first token). */
export interface AssistantStepMetadata {
  stepStartTime: number | null
  firstTokenTime: number | null
}

/**
 * Composite map key for one assistant step.
 * @param turn - turn number from the event payload.
 * @param step - step number from the event payload.
 * @returns collision-free `turn`/`step` key (NUL separator).
 */
export function assistantStepKey(turn: number, step: number): string {
  return `${turn}\u0000${step}`
}

/**
 * Fold one event into the per-step timing index: step/start opens the entry,
 * the first non-empty token delta stamps first-token time once. Other event
 * types are no-ops.
 * @param steps - the mutable per-step index, keyed by {@link assistantStepKey}.
 * @param event - the raw window event.
 */
export function indexAssistantStepTiming(steps: Map<string, AssistantStepMetadata>, event: SessionEvent): void {
  if (event.type === 'step/start') {
    steps.set(
      assistantStepKey(event.data.turn, event.data.step),
      { stepStartTime: event.time, firstTokenTime: null },
    )
  } else if (event.type === 'assistant/chunk' && isTokenDelta(event.data.chunk)) {
    const key = assistantStepKey(event.data.turn, event.data.step)
    const current = steps.get(key) ?? { stepStartTime: null, firstTokenTime: null }
    if (current.firstTokenTime === null) {
      steps.set(key, { ...current, firstTokenTime: event.time })
    }
  }
}

/**
 * Settle one finalized assistant message's timing from its step entry; a step
 * whose start or first token fell outside the window yields null boundaries.
 * @param steps - the per-step index built by {@link indexAssistantStepTiming}.
 * @param turn - the assistant/message turn number.
 * @param step - the assistant/message step number.
 * @param completedTime - the assistant/message event timestamp (epoch ms).
 * @returns the node-ready timing record.
 */
export function settledAssistantTiming(
  steps: ReadonlyMap<string, AssistantStepMetadata>,
  turn: number,
  step: number,
  completedTime: number,
): AssistantTiming {
  return {
    ...(steps.get(assistantStepKey(turn, step)) ?? { stepStartTime: null, firstTokenTime: null }),
    completedTime,
  }
}
