/**
 * Same-session goal domain: event-sourced state, compare-and-set mutations,
 * and process-local continuation activation.
 * @module @deepseek-ai/dsh-goal
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: resolves ctx.sessionProjections for the optional unit child.
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  applyGoalEvent,
  decodeGoalChange,
  emptyGoalFoldState,
  goalChangeRef,
} from './fold.ts'
import type { GoalFoldState } from './fold.ts'
import {
  GOAL_CHANGE_VERSION,
  GoalError,
  GoalId,
} from './runtime.ts'
import type {
  CreateGoalRequest,
  CreateGoalResult,
  EditGoalRequest,
  GoalActivation,
  GoalBlockReason,
  GoalPhase,
  GoalProjection,
  GoalRef,
  GoalSnapshot,
  GoalView,
} from './types.ts'
import type {
  GoalChangeMeta,
  GoalChanged,
  GoalClearChangeMeta,
  GoalOperation,
  GoalSnapshotChangeMeta,
} from './domain.ts'

// The pure payload outlet (./types.ts, ONE home of the `goal` projection-key
// declaration) re-exported onto the package root keeps the module edge in
// the emitted index.d.ts, so aggregate programs consuming the declarations
// still receive the SessionProjectionMap merge.
export type * from './types.ts'
export type * from './domain.ts'
export { GOAL_CHANGE_VERSION, GoalError, GoalId } from './runtime.ts'
export { decodeGoalChange, foldGoal, goalChangeRef } from './fold.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    goals: GoalService
  }
}

/** Wire payload schema of the `goal` projection (whole current goal or pre-create/cleared null). */
const goalProjectionSchema: ZodType<GoalProjection | null> = zod.union([
  zod.object({
    goal: zod.object({
      id: zod.string().min(1),
      revision: zod.number().int().positive(),
      objective: zod.string().min(1),
      phase: zod.union([zod.literal('active'), zod.literal('paused'), zod.literal('blocked'), zod.literal('complete')]),
      blockedReason: zod.object({ code: zod.string(), message: zod.string() }).optional(),
      maxGoalRounds: zod.number().int().positive(),
    }),
    roundsStarted: zod.number().int().nonnegative(),
    createdAt: zod.number(),
    updatedAt: zod.number(),
  }),
  zod.null(),
]) as ZodType<GoalProjection | null>

/**
 * Light last-wins fold of the `goal` projection unit. Unlike the strict
 * replay fold (fold.ts: transition validation, fail-loud on malformed
 * changes, Set-typed state), this transition is projection-grade: the state
 * is plain JSON (persisted-cache precondition), any non-goal or malformed
 * event returns the same reference (the registry's Object.is gate — the
 * title/todos posture), and correctness of the written change is the write
 * side's job (GoalService validated it before appending; the package
 * invariant rejects a violating stream fail-loud where it is installed).
 * @param state - the projection covering all prior events.
 * @param event - the next committed session event.
 * @returns the next projection (same reference when the event is not a goal change).
 */
export function applyGoalProjection(state: GoalProjection | null, event: SessionEvent): GoalProjection | null {
  if (event.type !== 'goal/change') return state
  let change: GoalChangeMeta | undefined
  try {
    change = decodeGoalChange(event.data)
  } catch (_invalidPersistedGoalChange) {
    return state
  }
  if (change === undefined) return state
  return change.operation === 'clear'
    ? null
    : {
      goal: change.goal,
      roundsStarted: change.roundsStarted,
      createdAt: change.createdAt,
      updatedAt: change.updatedAt,
    }
}

/** Deployment defaults for goal creation. */
export interface Config {
  /** Total rounds used when a create request omits its own cap. */
  defaultMaxGoalRounds?: number
}

/** Resolved defaults. */
export interface ResolvedConfig {
  /** Validated positive safe-integer default round cap. */
  defaultMaxGoalRounds: number
}

/** Process-local cache plus activation intent crossing the synchronous append boundary. */
interface GoalCache {
  readonly state: GoalFoldState
  activation: GoalActivation
  observedSeq: number
  pendingActivation: { readonly seq: number; readonly activation: GoalActivation } | undefined
}

/** Validated create input with every deployment default materialized. */
interface ResolvedCreateGoal {
  readonly objective: string
  readonly maxGoalRounds: number
}

/** Validate a caller-visible positive safe-integer round cap. */
function resolveMaxGoalRounds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new GoalError('maxGoalRounds must be a positive safe integer', 'GOAL_INVALID_MAX_ROUNDS')
  }
  return value
}

/** Validate and normalize an objective at the domain boundary. */
function resolveObjective(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GoalError('goal objective must be a non-empty string', 'GOAL_INVALID_OBJECTIVE')
  }
  return value.trim()
}

/** Materialize deployment defaults and validate one create request. */
function resolveCreateGoal(request: CreateGoalRequest, defaultMaxGoalRounds: number): ResolvedCreateGoal {
  return {
    objective: resolveObjective(request.objective),
    maxGoalRounds: resolveMaxGoalRounds(request.maxGoalRounds ?? defaultMaxGoalRounds),
  }
}

/** Validate and detach one policy-owned blocker explanation. */
function resolveBlockReason(reason: unknown): GoalBlockReason {
  const record = typeof reason === 'object' && reason !== null && !Array.isArray(reason)
    ? reason as Record<string, unknown>
    : undefined
  const code = record?.['code']
  const message = record?.['message']
  if (typeof code !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(code)
    || typeof message !== 'string' || message.trim().length === 0) {
    throw new GoalError(
      'goal block reason requires a lower-kebab-case code and a non-empty message',
      'GOAL_INVALID_BLOCK_REASON',
    )
  }
  return { code, message: message.trim() }
}

/** Goal service (`ctx.goals`) backed exclusively by the owning session log. */
export class GoalService extends TypertRemoteService {
  static inject = ['agents']

  static Config: z<Config> = z.object({
    defaultMaxGoalRounds: z.number().default(256),
  })

  private readonly resolved: ResolvedConfig
  private readonly caches = new WeakMap<Session, GoalCache>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'goals')
    this.resolved = {
      defaultMaxGoalRounds: resolveMaxGoalRounds(config.defaultMaxGoalRounds ?? 256),
    }
    ctx.on('agent/session-start', ({ agent }) => {
      this.cache(agent.session).activation = 'disarmed'
    })
    // The `goal` projection unit: last-wins fold of goal/change whole values
    // (see applyGoalProjection). The unit child activates only when a
    // projection registry is composed (headless assemblies stay unaffected).
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'goal', GoalProjection | null>({
        key: 'goal',
        schema: goalProjectionSchema,
        init: () => null,
        apply: applyGoalProjection,
        view: state => state,
        stateVersion: 4,
      })
    })
  }

  /**
   * Read the current goal for one exact live agent.
   * @param agent - owning live agent.
   * @returns a fresh view or `undefined` when no goal is current.
   * @throws {@link GoalError} when the agent is not the registry's live instance.
   */
  get(agent: Agent): GoalView | undefined {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    this.sync(agent.session, cache)
    return this.view(cache)
  }

  /**
   * Remove process-local continuation authority without changing durable goal
   * phase or revision. Lifecycle owners use this before unloading a driver;
   * a later human-authorized {@link resume} records the new activation edge.
   * @param agent - owning live agent.
   * @returns a fresh disarmed view, or `undefined` when no goal is current.
   */
  disarm(agent: Agent): GoalView | undefined {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    this.sync(agent.session, cache)
    cache.activation = 'disarmed'
    return this.view(cache)
  }

  /**
   * Create and arm a goal. A completed goal may be replaced; every other
   * current phase must be cleared or resumed instead.
   * @param agent - owning live agent.
   * @param request - objective and optional round cap.
   * @returns the created live view.
   */
  create(agent: Agent, request: CreateGoalRequest): GoalView {
    const spec = resolveCreateGoal(request, this.resolved.defaultMaxGoalRounds)
    const cache = this.prepareMutation(agent)
    const current = cache.state.goal
    if (current !== undefined && current.phase !== 'complete') {
      throw new GoalError(`goal "${current.id}" already exists with phase "${current.phase}"`, 'GOAL_ALREADY_EXISTS')
    }
    const now = Date.now()
    const goal: GoalSnapshot = {
      id: GoalId(`goal-${randomUUID()}`),
      revision: 1,
      objective: spec.objective,
      phase: 'active',
      maxGoalRounds: spec.maxGoalRounds,
    }
    return this.commitSnapshot(agent, cache, 'create', goal, 0, now, now, 'armed')
  }

  /**
   * Edit objective and/or round cap without changing phase.
   * @param agent - owning live agent.
   * @param ref - expected current revision.
   * @param request - at least one replacement field.
   * @returns the edited view.
   */
  @Remote('edit')
  edit(agent: Agent, ref: GoalRef, request: EditGoalRequest): GoalView {
    const cache = this.prepareMutation(agent)
    const current = this.expectCurrent(cache, ref)
    if (request.objective === undefined && request.maxGoalRounds === undefined) {
      throw new GoalError('goal edit requires objective and/or maxGoalRounds', 'GOAL_INVALID_EDIT')
    }
    const goal: GoalSnapshot = {
      ...current,
      revision: current.revision + 1,
      ...request.objective === undefined ? {} : { objective: resolveObjective(request.objective) },
      ...request.maxGoalRounds === undefined ? {} : { maxGoalRounds: resolveMaxGoalRounds(request.maxGoalRounds) },
    }
    return this.commitCurrent(agent, cache, 'edit', goal, cache.activation)
  }

  /**
   * Pause an active goal and disarm automatic continuation.
   * @param agent - owning live agent.
   * @param ref - expected current revision.
   * @returns the paused view.
   */
  @Remote('pause')
  pause(agent: Agent, ref: GoalRef): GoalView {
    return this.transition(agent, ref, 'pause', ['active'], 'paused', 'disarmed')
  }

  /**
   * Resume and arm a stopped goal, or rearm an active goal after a
   * session-start edge, while its round budget still has capacity.
   * @param agent - owning live agent.
   * @param ref - expected current revision.
   * @returns the active view.
   */
  @Remote('resume')
  resume(agent: Agent, ref: GoalRef): GoalView {
    const cache = this.prepareMutation(agent)
    const current = this.expectCurrent(cache, ref)
    const resumable: readonly GoalPhase[] = ['active', 'paused', 'blocked']
    if (!resumable.includes(current.phase)) {
      throw this.transitionError(current, 'resume', resumable)
    }
    if (current.phase === 'active' && cache.activation === 'armed') {
      throw new GoalError(`goal "${current.id}" is already active and armed`, 'GOAL_INVALID_TRANSITION')
    }
    if (cache.state.roundsStarted >= current.maxGoalRounds) {
      throw new GoalError(
        `goal "${current.id}" exhausted ${current.maxGoalRounds} goal rounds; increase maxGoalRounds before resuming`,
        'GOAL_INVALID_TRANSITION',
      )
    }
    return this.commitCurrent(agent, cache, 'resume', this.withPhase(current, 'active'), 'armed')
  }

  /**
   * Mark a current non-complete goal complete and disarm it.
   * @param agent - owning live agent.
   * @param ref - expected current revision.
   * @returns the completed view.
   */
  @Remote('complete')
  complete(agent: Agent, ref: GoalRef): GoalView {
    return this.transition(
      agent,
      ref,
      'complete',
      ['active', 'paused', 'blocked'],
      'complete',
      'disarmed',
    )
  }

  /**
   * Mark an active goal blocked and disarm it.
   * @param agent - owning live agent.
   * @param ref - expected current revision.
   * @param reason - policy-owned stable code and human-readable explanation.
   * @returns the blocked view with its durable reason.
   */
  block(agent: Agent, ref: GoalRef, reason: GoalBlockReason): GoalView {
    const cache = this.prepareMutation(agent)
    const current = this.expectCurrent(cache, ref)
    if (current.phase !== 'active') {
      throw this.transitionError(current, 'block', ['active'])
    }
    return this.commitCurrent(
      agent,
      cache,
      'block',
      { ...this.withPhase(current, 'blocked'), blockedReason: resolveBlockReason(reason) },
      'disarmed',
    )
  }

  /**
   * Clear the current goal while retaining a durable tombstone and history.
   * @param agent - owning live agent.
   * @param ref - expected current revision.
   * @returns the tombstone ref whose revision is one past the cleared snapshot.
   */
  @Remote('clear')
  clear(agent: Agent, ref: GoalRef): GoalRef {
    const cache = this.prepareMutation(agent)
    const current = this.expectCurrent(cache, ref)
    const tombstone: GoalRef = { id: current.id, revision: current.revision + 1 }
    const change: GoalClearChangeMeta = {
      kind: 'goal/change',
      version: GOAL_CHANGE_VERSION,
      operation: 'clear',
      cleared: tombstone,
      clearedAt: this.nextMutationTime(cache),
    }
    this.commit(agent, cache, change, 'disarmed')
    return { ...tombstone }
  }

  /** Resolve and validate the cache used by a mutation. */
  private prepareMutation(agent: Agent): GoalCache {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    this.sync(agent.session, cache)
    return cache
  }

  /** Reject stale or missing current-state refs. */
  private expectCurrent(cache: GoalCache, ref: GoalRef): GoalSnapshot {
    const current = cache.state.goal
    if (current === undefined) throw new GoalError('no current goal', 'GOAL_NOT_FOUND')
    if (ref.id !== current.id || ref.revision !== current.revision) {
      throw new GoalError(
        `stale goal ref "${ref.id}" revision ${ref.revision}; current is "${current.id}" revision ${current.revision}`,
        'GOAL_STALE_REVISION',
      )
    }
    return current
  }

  /** Enforce exact live-agent identity rather than trusting a matching id. */
  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new GoalError(`agent "${agent.id}" is not live in this registry`, 'GOAL_AGENT_NOT_LIVE')
    }
  }

  /** Return the per-session cache, folding a seed once with activation disarmed. */
  private cache(session: Session): GoalCache {
    let cache = this.caches.get(session)
    if (cache !== undefined) return cache
    const state = emptyGoalFoldState()
    for (const event of session.events) applyGoalEvent(state, event)
    cache = {
      state,
      activation: 'disarmed',
      observedSeq: session.seq,
      pendingActivation: undefined,
    }
    this.caches.set(session, cache)
    return cache
  }

  /** Incrementally observe durable events and reconcile local activation intent. */
  private sync(session: Session, cache: GoalCache): void {
    for (const event of session.events.slice(cache.observedSeq)) {
      applyGoalEvent(cache.state, event)
      if (event.type === 'goal/change') {
        cache.activation = cache.pendingActivation?.seq === event.seq
          ? cache.pendingActivation.activation
          : 'disarmed'
      }
      cache.observedSeq += 1
    }
  }

  /** Build a new revision with one replacement phase. */
  private withPhase(current: GoalSnapshot, phase: GoalPhase): GoalSnapshot {
    return {
      id: current.id,
      revision: current.revision + 1,
      objective: current.objective,
      phase,
      maxGoalRounds: current.maxGoalRounds,
    }
  }

  /** Shared validated phase transition. */
  private transition(
    agent: Agent,
    ref: GoalRef,
    operation: Exclude<GoalOperation, 'create' | 'edit' | 'clear'>,
    allowed: readonly GoalPhase[],
    phase: GoalPhase,
    activation: GoalActivation,
  ): GoalView {
    const cache = this.prepareMutation(agent)
    const current = this.expectCurrent(cache, ref)
    if (!allowed.includes(current.phase)) throw this.transitionError(current, operation, allowed)
    return this.commitCurrent(agent, cache, operation, this.withPhase(current, phase), activation)
  }

  /** Render a stable invalid-transition error. */
  private transitionError(current: GoalSnapshot, operation: GoalOperation, allowed: readonly GoalPhase[]): GoalError {
    return new GoalError(
      `cannot ${operation} goal "${current.id}" from phase "${current.phase}"; expected ${allowed.join(' or ')}`,
      'GOAL_INVALID_TRANSITION',
    )
  }

  /** Commit a mutation that retains the current goal's derived counters/times. */
  private commitCurrent(
    agent: Agent,
    cache: GoalCache,
    operation: Exclude<GoalOperation, 'create' | 'clear'>,
    goal: GoalSnapshot,
    activation: GoalActivation,
  ): GoalView {
    const createdAt = cache.state.createdAt
    /* v8 ignore next -- strict replay and every snapshot commit set createdAt whenever a current goal exists */
    if (createdAt === undefined) throw new Error('current goal cache lacks createdAt')
    return this.commitSnapshot(
      agent,
      cache,
      operation,
      goal,
      cache.state.roundsStarted,
      createdAt,
      this.nextMutationTime(cache),
      activation,
    )
  }

  /** Clamp a current goal's next timestamp across backward wall-clock movement. */
  private nextMutationTime(cache: GoalCache): number {
    const updatedAt = cache.state.updatedAt
    /* v8 ignore next -- strict replay and every snapshot commit set updatedAt whenever a current goal exists */
    if (updatedAt === undefined) throw new Error('current goal cache lacks updatedAt')
    return Math.max(Date.now(), updatedAt)
  }

  /** Build and commit one full-snapshot mutation. */
  private commitSnapshot(
    agent: Agent,
    cache: GoalCache,
    operation: Exclude<GoalOperation, 'clear'>,
    goal: GoalSnapshot,
    roundsStarted: number,
    createdAt: number,
    updatedAt: number,
    activation: GoalActivation,
  ): GoalView {
    const change: GoalSnapshotChangeMeta = {
      kind: 'goal/change',
      version: GOAL_CHANGE_VERSION,
      operation,
      goal,
      roundsStarted,
      createdAt,
      updatedAt,
    }
    this.commit(agent, cache, change, activation)
    const view = this.view(cache)
    /* v8 ignore next -- the durable goal event installs the snapshot before this read */
    if (view === undefined) throw new Error('snapshot commit cleared the goal unexpectedly')
    return view
  }

  /** Commit one mutation into the goal log, cache, and live event stream. */
  private commit(agent: Agent, cache: GoalCache, change: GoalChangeMeta, activation: GoalActivation): void {
    const ref = goalChangeRef(change)
    cache.pendingActivation = { seq: agent.session.seq, activation }
    try {
      agent.session.append('goal/change', change)
      this.sync(agent.session, cache)
    } finally {
      cache.pendingActivation = undefined
    }
    const goal = this.view(cache)
    const notification: GoalChanged = {
      operation: change.operation,
      ref: { ...ref },
      ...goal === undefined ? {} : { goal },
    }
    agentEvents(this.ctx, agent).emit('goal/changed', { change: notification })
  }

  /** Build a detached current view. */
  private view(cache: GoalCache): GoalView | undefined {
    const goal = cache.state.goal
    const createdAt = cache.state.createdAt
    const updatedAt = cache.state.updatedAt
    if (goal === undefined) return undefined
    /* v8 ignore next 3 -- strict replay and snapshot commits establish both timestamps with every current goal */
    if (createdAt === undefined || updatedAt === undefined) {
      throw new Error(`goal "${goal.id}" cache lacks timestamps`)
    }
    return {
      ...goal,
      roundsStarted: cache.state.roundsStarted,
      createdAt,
      updatedAt,
      activation: cache.activation,
    }
  }

  /**
   * Create one Goal through the remote boundary.
   * @param agent - exact live Agent resolved from the wire identity.
   * @param request - objective and optional round cap.
   * @returns the created Goal identity.
   */
  @Remote('create')
  remoteExportCreate(agent: Agent, request: CreateGoalRequest): CreateGoalResult {
    const view = this.create(agent, request)
    return { ref: { id: view.id, revision: view.revision } }
  }
}

export default GoalService
