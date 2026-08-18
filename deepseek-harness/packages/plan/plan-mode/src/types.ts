/**
 * Pure types of the plan domain: the ONE home of the `plan` projection-key
 * declaration, free of this package's host-side value imports (cordis
 * service, dsh-tools, dsh-agent). Two namespace projections serve it —
 * `./types` for host consumers, `./client` for client aggregates — with zero
 * content duplication.
 *
 * @module @deepseek-ai/dsh-plan-mode/types
 */

/**
 * The plan projection's wire value. `active` is the logged state in force
 * (the last `plan/mode`, inactive before the first); `pending` is true while
 * a logged `/plan` selection (`command/run`) targets a state other than
 * `active` and no later `plan/mode` event has recorded that state. Capability
 * absence (plan-mode not composed) is the key's absence, never a value.
 */
export interface PlanProjection {
  active: boolean
  pending: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Plan collaboration state folded from `command/run` (name `plan`) and `plan/mode` events. */
    plan: PlanProjection
  }
}
