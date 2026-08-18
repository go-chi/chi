# @deepseek-ai/dsh-goal

English | [中文](README.zh.md)

Event-sourced same-session goal state. The service retains one current completion objective in an agent's existing session while keeping permission to continue as process-local activation. The [goal-domain Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-persisted-same-session-goal-domain.md) owns the design rationale; the [goal type catalog](../../../docs/subsystems/goal.md) records the literal data shapes.

## Config

```yaml
- id: goal
  name: '@deepseek-ai/dsh-goal'
  config:
    defaultMaxGoalRounds: 256
```

`defaultMaxGoalRounds` must be a positive safe integer. `create()` materializes this deployment default internally before committing a goal; a request-level value overrides it.

## Service contract

`ctx.goals` accepts only the exact live `Agent` instance registered under its id. `get()` returns a detached `GoalView`; mutations use a `GoalRef { id, revision }` compare-and-set fence and reject stale refs. The service exposes create, edit, pause, resume, complete, block, and clear verbs through the generated region of [goal.md](../../../docs/subsystems/goal.md#cordis-surface). Creation default resolution is internal. `disarm()` is the lifecycle-only exception: it removes process-local continuation authority without writing a revision or emitting a mutation.

At most one goal is current. Creation produces an active revision-one goal and arms it. A non-complete goal must be edited, transitioned, or cleared; a completed goal may be replaced by a globally fresh id. Edits retain phase, blocker reason, and activation. Pause, completion, blocking, and clear disarm activation. A block records a policy-owned lower-kebab-case code plus a normalized free-form explanation; provider limits, configured budgets, execution errors, and requests for human input all use this one durable phase rather than multiplying lifecycle states. Resume accepts a stopped phase or a disarmed active goal only while the configured round cap has remaining capacity; it clears any former blocker reason. An active armed goal rejects the redundant operation.

Every mutation appends a durable `goal/change` event carrying the complete post-mutation snapshot; clear uses a revisioned tombstone. Goal state therefore does not depend on inbox placement, claim, admission, or discard. The session log is the only durable authority.

Strict replay derives lifecycle mutations only from `goal/change` and rejects malformed shapes, discontinuous revisions, illegal lifecycle transitions, non-monotonic per-goal timestamps, and non-sequential admitted goal rounds. Positive rounds advance only on admitted goal-sourced `user/message` events. Mutation timestamps clamp against the preceding goal update when wall time moves backward. Incremental replay retains its cursor at the first corrupt event, and `goal/changed` fires after the durable event commits with listener failures contained.

Activation is never persisted. A fresh cache and every `agent/session-start` edge disarm it even when replay finds an active durable phase. A continuation driver also calls `disarm()` before unload or after durability uncertainty. Session resume, fork, and driver replacement therefore retain the objective, phase, revisions, and admitted-round count without initiating work; a later explicit resume mutation must arm continuation.

The separately published `./invariant` companion maintains an independent fold of each attached session. It rejects malformed goal changes, discontinuous revisions, illegal lifecycle transitions, timestamp regressions, and non-sequential admitted rounds before the candidate event enters the durable log.

## Extension points

Policy plugins call the service verbs and react to the scoped `goal/changed` event. A continuation consumer admits rounds as `user/message` events with `GoalMessageSource`; ordinary human turns never increment `roundsStarted`. Consumers use the `Agent` interface and events rather than importing `dsh-agent-loop`.

## Model Experience

### Goal-state mutation

#### What the model sees

Goal mutations do not inject model context. Tools such as `get_goal` return the current state, and a continuation consumer may render the objective and round state when it schedules model work. A future always-visible goal context belongs in a separate context plugin rather than the persistence path.

#### Token effect

Goal mutation events add no model tokens by themselves. Tool results and scheduled continuation prompts account for their own visible state.

#### KV Cache effect

There is no KV-cache effect until another component exposes goal state in model-visible input.

## Known Limitations and Deferred Work

- **State, not scheduling** — this package does not decide when an armed goal continues, retry abnormal failures, or cancel an active turn; those policies belong to agent-seam consumers.
- **Round-count budget only** — `maxGoalRounds` does not meter tokens, currency, wall time, or provider quotas.
- **No independent evaluator** — the caller that records completion or blocking is authoritative; evaluator-backed certification is deferred to a separate policy layer.
- **One current goal** — parallel objectives and a separate goal database are intentionally absent; history remains available in the session log after replacement or clear.
- **Trusted in-process producers** — a plugin with direct `Session` access can append counterfeit `goal/change` data. Strict replay detects malformed or inconsistent records and leaves goal access failed at that record until the log is repaired; this is integrity detection, not plugin isolation.
