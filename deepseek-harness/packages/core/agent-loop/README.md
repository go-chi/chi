# dsh-agent-loop

English | [中文](README.zh.md)

THE concrete agent plugin and loop driver. Its package-internal implementation satisfies the `Agent` interface and drives the session/turn/step lifecycle.

This is the only package in the harness that contains concrete loop logic. Everything else is an abstract service or a plugin against extension points — new behavior goes into plugins, not here.

## Service: `AgentLoop` (ctx key: `agentLoop`)

### Public API

Creation and resume are one rollback-covered transaction: construct a private session, concrete agent, and scoped context; await optional setup; enter both registries; announce `session/created` then `agent/created`; emit `agent/session-start`; and only then start the driver. Setup receives the full scoped `Context` as trusted same-process composition code and must not drive the unpublished agent. Ordinary typed identity and option inputs are borrowed under their readonly contract, while seed events and session metadata are validated and snapshotted because they cross the durable session boundary. An optional `AbortSignal` cancels only load/setup/publication and is detached before the returned handle becomes visible.

The caller fiber and the AgentLoop provider are co-owners. `AgentFactory.createAgent(ownerCtx, options)` and `resume(ownerCtx, options)` receive caller ownership explicitly, while the factory keeps its own dependency context for `sessions`/`llm`/`tools`/`systemPrompt`; this lets a caller inject only `agents` without shrinking the new agent's service set. Caller unload, handle disposal, or provider unload converge on one memoized quiescence boundary. Provider shutdown waits both resource teardown and the public create/resume wrapper that observed deactivation, so no continuation can publish after dependencies disappear.

Each agent and its session share one caller-chosen `SessionId`, assumed globally unique; accidental UUID collisions are outside the supported model. Two concurrent operations with the same id may both prepare, but the final `enter()` calls arbitrate publication and every loser rolls its private resources back. Each detach is bound to the exact entered object, so a stale disposer cannot remove a later same-id replacement. A detach requested during a synchronous creation notification waits for that dispatch to unwind, preserving created/disposed pairing. Teardown runs stop and drain → unwind scope → detach agent → detach session; the id becomes reusable after private scope cleanup. Ordinary non-vetoing `agent/*` notifications go through `agentEvents(ctx, agent)`, and per-step assembly goes through `assembleContextFor(agent)`.

- `ctx.agentLoop.create(id: SessionId, options?: AgentOptions, meta?: { cwd?: string }): Agent` — synchronous no-setup create under the exact shared agent/session id, disposed with the calling fiber. Declarative config treats `agents[].id` as a stable label and normally mints `${label}-session-<uuid>` before calling this boundary. An app may instead supply a stable exact `sessionId`: first use creates it, while a remount with persistence already present resumes its materialized history. `resumeSessionId` requires and loads an existing persisted id and is mutually exclusive with `sessionId`. This keeps default fresh restarts collision-free without retaining a second live routing identity.

`AgentLoop` also implements the `AgentFactory` contract and registers itself via `ctx.agents.setFactory(this)`, so plugins create/resume agents through `ctx.agents`:

- `ctx.agents.create({ sessionId, meta?, seed?, agentOptions?, setup?, signal? }): Promise<AgentHandle>` — programmatic create under the caller-supplied shared id. It awaits the unpublished setup transaction before returning; `meta` carries cwd/lineage/seed-boundary metadata and `seed` reconstructs a forked child prefix after the session boundary validates and snapshots the durable values. `signal` applies only until this promise settles. The resolved [`AgentHandle`](../agent/README.md) owns exact teardown.
- `ctx.agents.resume({ resumeSessionId, agentOptions?, setup?, signal? }): Promise<AgentHandle>` — load a persisted session via `ctx.sessionPersistence` ([session persistence](../../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)), register the agent under that same id, reconstruct its history, then await setup against a fresh unpublished agent scope before rollback-covered publication. Turn numbering and derived history continue from the loaded log. Requires a session-persistence backend (NOT hard-injected — non-persistent demos still work; `resume` rejects with a clear error when persistence is absent). `signal` is creation-only. Returns an `AgentHandle`.

The config-driven `ctx.agentLoop.create()` path keeps its agent owned by the loop fiber (it discards the handle). For a programmatic agent, the handle holder is the only consumer-facing teardown capability; AgentLoop provider unload is the independent structural teardown edge, not another handle exposed to application code.

### Injected services

`agents`, `sessions`, `llm`, `tools`, `systemPrompt` — all five interface services.

### Invariant companion

The optional `@deepseek-ai/dsh-agent-loop/invariant` companion registers request reconstruction with `ctx.invariants`. The loop records each exact frozen request in the process-local identity set owned by `dsh-llm`; the companion then requires a live session and independently rebuilds the message boundary and folded request header from the log. Direct one-shot calls remain outside this contract even when callers freeze them or attach a session id.

### Configuration (schemastery)

```ts
interface Config {
  maxParallelToolCalls?: number // default 10; 1 is serial
  agents: Array<{
    id: string                 // required
    provider?: string
    model?: string
    maxTokens?: number         // positive per-request output-token cap
    resumeSessionId?: string   // load this persisted session instead of creating one
    cwd?: string               // optional workspace cwd for the fresh session
  }>
}
```

Configured agents start automatically. A model call requires both `provider` and `model`; `agent/request` may supply a missing pair before dispatch. An optional positive `maxTokens` seeds each conversation request's output cap and is logged in its request header. `maxParallelToolCalls` bounds every agent's rolling pool for parallel-safe calls and defaults to `10`; it is also the whole of the `agent-loop` Settings section, so a user layer over this entry caps the next tool group without a restart, and a value that is not a positive integer is refused at the write rather than at that group. `agents` is deliberately absent from that section — it is consumed once when the service starts, so a stored change could only look like it had an effect. `cwd` applies only to fresh sessions, while `resumeSessionId` retains persisted metadata. Configured agents use the deployment persona, and programmatic setup can shadow it per agent. This plugin supplies the per-agent `provider`, `model`, and `cwd` prompt variables; harness identity and deployment persona belong to `dsh-system-prompt`.

### Internal concrete driver

The concrete `ReactLoopAgent`, its inbox, and run controls are package-internal. The package root exports only the plugin/service/config contract, and the package exports map exposes no `./src/*` escape hatch; lifecycle owners create agents through `ctx.agents` rather than naming, constructing, or starting driver internals. One prepared session can be claimed by only one concrete driver, and everything observable happens through session events and the `agent/*` event taxonomy.

The unified `send()` primitive routes content and source by (`target` × `wakeup`); `followup`/`steer`/`inject` are its fixed-preset aliases. `followup()` appends to the `next-turn` FIFO and wakes the driver, `steer()` appends to the `next-step` inbox and wakes it, and `inject()` appends to that same `next-step` inbox without waking it. At a turn boundary the driver opens the durable turn, then atomically claims pending next-step input plus one queued prompt; between steps it claims only next-step input. Claiming removes the batch through pure deletion splices and emits `agent/inbox/claimed { message, turn }` once per message. `agent/pre-step` then returns either rejection or the complete messages entering the proposed step. Rejection leaves the claimed batch removed and closes the turn without a step; input inserted after the claim remains pending, and idle injection waits until follow-up or steering wakes the driver.

Every inbox mutation publishes one normalized `agent/inbox/spliced` event before changing the live projection. Insertions, edits, removals, claiming, and cancellation replay through the same standard splice coordinates. Ordinary removals carry `outcome: 'canceled'` and emit `agent/inbox/discarded { message }`; claiming uses pure deletions with no outcome, after which the loop emits `agent/inbox/claimed`. Every insertion emits `agent/inbox/inserted { message }`. `MessageId` stays unique across both pending lists, and synchronous durable-event observers can reconstruct removed values from the pre-splice projection.

### Loop lifecycle (`agent.ts`)

The driver owns one agent for its lifetime and runs inside `ctx.agents.withInitiator(agent, ...)`. Package-private orchestration entry points recover the exact Agent, derive `agent.session` once, and let operation-local helpers capture it instead of forwarding the concrete driver or per-operation `Session` through shallow interfaces. A helper keeps an explicit `Session` when that is its actual interface, while creation, persistence load, unpublished setup, services, workers, processes, persistence, and wire protocols retain their explicit identities. The [agent service](../agent/README.md#initiating-agent-scope) owns propagation, teardown, and detached-work rules.

Every provider call that reaches a successful finish appends exactly one `assistant/message` completion anchor, including content-less calls and `max-tokens` finishes. The anchor records the assembled content as-is, lists the exact chunk seqs in `sourceEventSeqs` (`[]` for a stream with no chunks), and includes usage when available; empty content stays out of derived message history.

After `agent/request` returns a provider/model call config, the loop asks `ctx.llm.prepareCall()` to validate adapter-owned fields and materialize configured reasoning-effort and output-token defaults under the active turn signal. The prepared call retains the exact adapter registration across this asynchronous resolution, `request/header` logging, and terminal dispatch, so HMR cannot mix one adapter's capability result with another adapter's request. The header records the effective config and which fields came from the adapter. Before the next waterfall, the loop removes those marked fields from the proposal so the current exact route rematerializes its own defaults; unmarked explicit settings persist across steps and route changes. A route with no registered adapter preserves the proposed config so an `llm/stream` listener can own and short-circuit it; unhandled terminal dispatch still fails with `NO_ADAPTER`. A new loop instance follows the same adapter-default marker rule when resuming.

Plugin failure ends the current turn, not the loop. Final adapter selection, dispatch, and iteration failures arrive from `ctx.llm` as terminal error or aborted finishes and enter `agent/request-error`; middleware, result processing, tools, and other extension failures remain thrown and close directly. Recovery receives request coordinates, immutable provider facts, the immutable retry policy captured by the prepared adapter registration, and the turn signal; the policy is absent when middleware owns an unprepared route. A handling listener returns `{ kind: 'retry' }`; an unhandled failure is terminal. AgentLoop owns one cancellation signal for the current admission or turn. An effective `cancel(cause)` clears pending work unless `keepInbox` is set and cooperatively aborts that signal; idle cancellation is a no-op. Waking input that lands after the abort fires but before the activity converges to idle is latched (`wakeRequested`) and replayed at the driver's own convergence boundary, so it runs without a further waking send; a `disposed` cancel never latches, and a wake submitted while already idle always opens its turn boundary (status shows a transient `idle → running → idle` pair even when the message was cleared). Durable `turn/end` records `aborted` for `user` and `parent`, while disposal records `disposed`; undispatched model tool calls receive synthetic `tool/call` and `ABORTED_BEFORE_DISPATCH` result pairs. The cancellation cause changes reporting, not how result context finalized after cancellation is handled. Disposal waits for signal-ignoring work before registry removal. The [explicit-cancellation decision](../../../.agents/notes/implemented/architecture/2026-07-16-explicit-turn-cancellation.md) and the [cancel-convergence wake latch](../../../.agents/notes/implemented/bug-fix/2026-08-07-cancel-convergence-wake-latch.md) own the lifecycle and race contract.

Within a step, exclusive calls form barriers; parallel-safe calls use a bounded rolling pool and are reclassified before start. Only dispatch/body overlaps. Policy, durable results, and result context remain model-ordered. Abort stops new calls, drains started results, and retains their finalized result context without distinguishing the cancellation cause. An internal scheduler failure stops new dispatches, waits for already-started dispatches, and reaches the turn error boundary without fabricating tool results.

### What belongs to plugins

Everything that goes beyond "call the model, run the tools, repeat" belongs to plugins listening on the event taxonomy:
- Hooks and policy: the relevant `agent/*` checkpoints plus the guarded `tools/pre-execute` → `tools/execute` → `tools/post-execute` → definition-owned `finalizeContent` → `tools/result` pipeline; exact event signatures and modes live in the generated regions of [core.md](../../../docs/subsystems/core.md#cordis-surface) and [tools.md](../../../docs/subsystems/tools.md#cordis-surface)
- Compaction: pressure on `agent/pre-step`; canonical overflow repair on `agent/request-error`
- Model-request recovery: `dsh-llm-retry` records and waits exact-provider normal or unbounded backoff on `agent/request-error`, emits non-surface `llm/retry` status, then returns a retry action
- Sandbox, permission, plan mode: `tools/pre-execute` for extensible deny/ask, `tools.guard()` for monotonic owner policy, `tools/post-execute` for result decisions, and `tools/result` for final observation
- Sub-agents: implemented outside the loop as `ctx.subagents` providers; in-process providers use `ctx.agents.create()` and owned `AgentHandle` teardown, while generic [`ctx.jobs`](../../jobs/jobs/) plus [`dsh-tool-subagent`](../../subagent/tool-subagent/) own background collection.
- Persistence: eager write-behind from `session/event`; `session/flush` is an explicit observation barrier
- UI: `session/event` (assistant token stream, boundaries, tool activity) + `agent/*` control events (`agent/status`, `agent/created`/`agent/disposed`)

## Model Experience

### Complete conversation request

#### What the model sees

For each step, the loop sends the rendered per-agent system prompt, visible tool schemas, and the session's derived messages. It supplies `provider`, `model`, and `cwd` variable values but no additional fixed prose.

#### Token effect

System text and schemas are paid again on every step. Per-agent scoping chooses the contributions, while the authoritative assembly waterfall can alter the final request and makes its listener responsible for protocol coherence.

#### KV Cache effect

Append-only only while system text, schemas, and earlier history remain byte-identical under the same provider and model route. A token-bearing assembly rewrite or composition change may invalidate reuse from the first altered request token.

### Retained message history

#### What the model sees

Accepted user messages, assistant messages, tool calls and results, injected context, and steering are logged and sent on later steps. Raw stream chunks, lifecycle boundaries, and other log-only events are excluded.

#### Token effect

Input grows with every surface message until a compaction replacement shadows older nodes; a multi-step tool turn resends the accumulated history each step.

#### KV Cache effect

Ordinary history growth is append-only and preserves reusable entries. A surface replacement or compaction invalidates reuse from the first shadowed history token.

### Undispatched calls after cancellation

#### What the model sees

If a later request replays an aborted step, each tool call that cancellation prevented from dispatching has error code `ABORTED_BEFORE_DISPATCH` and result text `Error: tool call aborted before dispatch`.

#### Token effect

One fixed error result per skipped call remains in history until compaction shadows it.

#### KV Cache effect

Append-only; each synthetic result follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Classification is unary** — calls whose safety depends on comparing siblings or resources must remain exclusive ([rationale](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)).
- **Config labels are fresh by default** — omitting `sessionId` creates a fresh `${id}-session-<uuid>` on every startup; exact resume-or-create behavior requires an explicit stable `sessionId`, while `resumeSessionId` requires existing persisted history.
- **Config agents have no per-agent persona field or setup hook** — they use the deployment persona; scoped persona/tool composition is available only through the programmatic `ctx.agents.create()` / `resume()` factory options.
- **No built-in turn budget** — tool calls or steering continue the current turn; a policy that bounds runaway turns must cancel from an existing lifecycle extension point such as `agent/turn-stopping`.
