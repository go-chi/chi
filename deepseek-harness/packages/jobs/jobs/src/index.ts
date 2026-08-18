/**
 * The background-job Service Definition (`ctx.jobs`). It owns the contract for
 * job ids, session-scoped access, lifecycle state, completion listeners, and
 * owner cleanup while producers retain their execution resources. The
 * process-local registry lives in `@deepseek-ai/dsh-jobs-local`.
 * @module @deepseek-ai/dsh-jobs
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  JobDoneListener, JobId, JobRead, JobSnapshot, JobStart, JobsChangedListener,
} from './types.ts'

export { JobId } from './types.ts'
export type {
  JobDoneListener,
  JobHooks,
  JobKind,
  JobKindMap,
  JobOutcome,
  JobRead,
  JobSnapshot,
  JobStart,
  JobStatus,
  JobsChangedListener,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    jobs: JobRegistry
  }
}

/**
 * Abstract background job registry. Subclass, implement the abstract methods,
 * and load the subclass as a plugin — it registers as `ctx.jobs` (one
 * implementation per context; loading a second throws, which is cordis'
 * standard duplicate-service behavior).
 *
 * Implementations must honor these semantics:
 * - Registrations outlive producer and controller fibers. Owner and
 *   service disposal cancel live work and await compliant producers; a
 *   throwing teardown cancel force-fails only the record. Teardown
 *   cancellation also marks the record reported, because a record its owner
 *   is being destroyed for has no reader left.
 * - Owned-job access is fenced by the owner's session id. Ids are
 *   predictable, so authorization — not secrecy — is the boundary.
 * - Settlement is first-wins: one terminal record, released waiters, and one
 *   round of contained listener notification, even against a late producer
 *   outcome. Completion is announced last, after the record is committed and
 *   every other observer of the settlement has seen it, because a reporter
 *   may open a model turn synchronously.
 * - {@link start} refuses work while no attached job controller serves the
 *   spec's owner, so a producer cannot start work that owner cannot collect
 *   or stop. One registry serves every composition in the process, so this
 *   question — and completion-listener delivery — is owner-relative rather
 *   than process-wide: registrations made from an unscoped context serve
 *   every owner, and registrations made under an agent composition's scope
 *   serve exactly the agents composed under it.
 */
export abstract class JobRegistry extends Service {
  constructor(ctx: Context) {
    // `abstract` erases at runtime, so a composition row naming this package
    // would register a ctx.jobs with no method implementations and fail far
    // from the misconfiguration. Fail loud at load instead.
    if (new.target === JobRegistry) {
      throw new Error('@deepseek-ai/dsh-jobs is the abstract job registry seam; load an implementation such as @deepseek-ai/dsh-jobs-local instead')
    }
    super(ctx, 'jobs')
  }

  /**
   * Preflight access, validation, owner cleanup, and implementation-owned
   * admission before starting and atomically registering work. Any preflight
   * rejection leaves no job id or execution resource. A throwing starter
   * leaves nothing registered; after it returns, registration cannot fail.
   * Settlement records the outcome, notifies listeners, and releases waiters.
   * @param spec - job identity, owner, and synchronous starter.
   * @returns the registry-issued `<kind>-N` id.
   */
  abstract start(spec: JobStart): JobId

  /**
   * List caller-owned and unowned jobs in registration order without exposing
   * another session's labels.
   * @param caller - reading agent; a non-agent caller sees only unowned jobs.
   * @returns fresh snapshots.
   */
  abstract list(caller?: Agent): JobSnapshot[]

  /**
   * Return a non-consuming snapshot without changing its read cursor or notice
   * state. Throws for an unknown or foreign job.
   * @param id - job to look up.
   * @param caller - reading agent checked against the owner.
   * @returns a fresh snapshot.
   */
  abstract get(id: JobId, caller?: Agent): JobSnapshot

  /**
   * Read the next stream delta, or the idempotent final output after settlement.
   * A terminal read marks the job reported. Throws for an unknown or foreign
   * job.
   * @param id - job to read.
   * @param caller - reading agent checked against the owner.
   * @returns output text and the post-read snapshot.
   */
  abstract read(id: JobId, caller?: Agent): JobRead

  /**
   * Request cancellation, then mark the job stopping and reported. A producer
   * throw propagates without changing job state. Throws for an unknown or
   * foreign job.
   * @param id - job to cancel.
   * @param caller - killing agent checked against the owner.
   * @param reason - logged reason forwarded to the producer.
   * @returns `requested` for live work, otherwise `already-finished`.
   */
  abstract kill(id: JobId, caller?: Agent, reason?: string): 'requested' | 'already-finished'

  /**
   * Wait for settlement or timeout without cancelling the job. Caller abort
   * rejects only while the job is live; after settlement the terminal
   * snapshot wins so a notice suppressed for this waiter is still delivered.
   * Throws for invalid, unknown, or foreign input.
   * @param id - job to wait for.
   * @param timeoutMs - positive finite wait bound in milliseconds.
   * @param caller - waiting agent checked against the owner.
   * @param signal - optional cancellation of the wait itself.
   * @returns snapshot at settlement or timeout.
   */
  abstract wait(id: JobId, timeoutMs: number, caller?: Agent, signal?: AbortSignal): Promise<JobSnapshot>

  /**
   * Register an effect-scoped completion listener. It receives the settlements
   * of the owners its registering context's scope covers; each listener is
   * contained; returned promises are observed but not awaited. No listener runs
   * after service disposal.
   * @param listener - receives each terminal snapshot and its exact owner.
   * @returns disposer that unregisters the listener.
   */
  abstract onJobDone(listener: JobDoneListener): () => void

  /**
  /**
   * Register an effect-scoped observer of visible-set changes. It fires after
   * every commit that changes what {@link list} returns for that owner —
   * registration, every stopping transition (including the one teardown
   * performs before it awaits a slow producer), settlement, owner-disposal
   * removal, and the emptying that service disposal commits — so an observer
   * re-reads rather than accumulating deltas.
   *
   * Delivery is owner-relative on the same terms as {@link onJobDone}: an
   * observer registered from an unscoped context — a host composition's own
   * carrier — sees every owner, while one registered under an agent
   * composition's scope sees exactly the agents composed under it.
   *
   * This is not a superset of {@link onJobDone}: that one delivers the terminal
   * record under first-wins semantics a job controller couples to notice
   * delivery, while this one carries no delivery meaning and marks nothing
   * reported. Listeners are contained and never awaited.
   * @param listener - receives the owner whose visible set changed, or
   *   `undefined` when an unowned job changed and every caller's set did.
   * @returns disposer that unregisters the listener.
   */
  abstract onJobsChanged(listener: JobsChangedListener): () => void

  /**
   * Attach an effect-scoped controller that can read and stop jobs. It serves the
   * owners its registering context's scope covers, and {@link start} refuses an
   * owner no attached controller serves.
   * @param name - diagnostic label; duplicate names remain independent.
   * @returns disposer that detaches this controller.
   */
  abstract attachController(name: string): () => void
}

export default JobRegistry
