/**
 * Exhaustiveness helper for closed core unions. Use {@link assertNever} at the default branch so a
 * new variant fails compilation at every required handler. Do not use it for declaration-merged
 * unions such as session events or content blocks: handle known variants and explicitly fall
 * through because plugins may add valid unknown cases.
 * @module @deepseek-ai/dsh-llm/never
 */

/**
 * Mark an unreachable closed-union branch. A newly unhandled typed variant fails at the call site;
 * a value that escaped its type throws with diagnostics at runtime.
 * @param value - the impossible value; typed `never` so an unhandled variant fails compilation at the call site.
 * @param context - optional label (e.g. the switch site) prefixed into the throw message.
 * @returns never — it always throws, with the offending value JSON-rendered in the message.
 */
export function assertNever(value: never, context?: string): never {
  // JSON.stringify is typed string but returns undefined for undefined input;
  // String() covers that and other non-serializable escapes.
  const rendered = (JSON.stringify(value) as string | undefined) ?? String(value)
  throw new Error(`unreachable variant${context ? ` in ${context}` : ''}: ${rendered}`)
}
