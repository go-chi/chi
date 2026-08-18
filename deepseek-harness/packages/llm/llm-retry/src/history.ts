/** Durable request-route lookup for one open model step. @module @deepseek-ai/dsh-llm-retry/history */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Find the provider in force for one currently open step.
 * Request headers remain effective across turn boundaries until a newer full
 * snapshot changes them; every provider change requires a newer full snapshot.
 * @param events - session events ending inside the open step.
 * @param turn - turn that owns the failed step.
 * @param step - failed step whose provider is required.
 * @returns the provider from the request header in force for the step.
 */
export function providerForOpenStep(
  events: readonly SessionEvent[],
  turn: number,
  step: number,
): string | undefined {
  const stepStartIndex = events.findLastIndex(event =>
    event.type === 'step/start'
    && event.data.turn === turn
    && event.data.step === step,
  )
  if (stepStartIndex < 0 || events.slice(stepStartIndex + 1).some(event =>
    event.type === 'step/end' || event.type === 'turn/end')) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    // The loop bounds prove this indexed read exists.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const event = events[index]!
    if (event.type === 'request/header') return event.data.header.config.provider
  }
  return undefined
}
