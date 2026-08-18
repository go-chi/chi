/**
 * Pure plan derivation for the todo_write row's one-line summary. Several items
 * may be `in_progress` at once — parallel work runs concurrent tasks, so a
 * summary built from one active item would silently drop the rest. The plan
 * strip header derives its own counts inline and shares nothing with this, so
 * this stays inside the toolviews domain rather than in `contract/` (the
 * inter-domain face).
 * @module
 */

/**
 * One list item as the row sees it: unvalidated model JSON parsed from a call's
 * args, so any field may be missing or mistyped.
 */
export interface PlanItemLike {
  content?: unknown
  status?: unknown
}

/**
 * Counts plus the two halves of the summary, deliberately NOT pre-joined: the
 * row ellipsizes its summary text, and a count concatenated onto the end of the
 * task name is the first thing a narrow row clips — exactly when it carries
 * information. The row renders `activeExtra` in its own non-shrinking span
 * beside the truncatable text.
 */
export interface PlanSummary {
  done: number
  total: number
  /** First `in_progress` content, or null when that first item is unusable. */
  activeContent: string | null
  /** Active items beyond the first; 0 whenever there is no `activeContent` to sit beside. */
  activeExtra: number
}

/**
 * Derive the counts and the active summary from a whole-list snapshot. It names
 * the first `in_progress` item and counts the remaining active ones, so a
 * parallel plan reports how many tasks are running rather than naming one and
 * hiding the others. `activeContent` is null when nothing is in progress, or
 * when the first active item's content is missing, mistyped, or blank once
 * trimmed — the tool's own rule for usable content, applied here because a
 * rejected call keeps its args verbatim. The row then renders the counts alone
 * rather than falling back to the generic tool summary: the counts are already
 * known to be good, and the active-item clause is the only part an unusable
 * name costs.
 * @param todos - the whole list, in model order.
 * @returns the done/total counts and the two summary halves.
 */
export function planSummary(todos: readonly PlanItemLike[]): PlanSummary {
  const active = todos.filter(t => t.status === 'in_progress')
  const first = active[0]?.content
  const named = typeof first === 'string' && first.trim() !== ''
  return {
    done: todos.filter(t => t.status === 'completed').length,
    total: todos.length,
    activeContent: named ? first : null,
    activeExtra: named ? active.length - 1 : 0,
  }
}
