# dsh-agent

English | [中文](README.zh.md)

Agent interface, registry, process-local initiator scope, and `agent/*` event vocabulary. Every plugin (UI, hooks, orchestrators) programs against the `Agent` handle defined here — it has zero loop dependency, so the loop is swappable.

The optional `@deepseek-ai/dsh-agent/invariant` companion registers this package's agent-status transition checks with `ctx.invariants`. The root agent service does not load diagnostics implicitly.

## Service: `AgentRegistry` (ctx key: `agents`)

Tracks live agents and carries the initiating Agent through asynchronous driver work without importing the concrete loop package.

### Public API

The scoped-registration surface: `Agent.ctx` is the agent's scope context (`dsh-scope`, key = the agent) — register tools/sections/variables/listeners through it for that agent alone, all unwound on disposal. `agentEvents(ctx, agent)` is the fused dispatcher for ordinary agent-subject operations (carrier + injected subject in one move); its notification mode invokes every listener and contains both synchronous throws and returned-promise rejections. The registry lifecycle pair reuses one stable routing carrier. `assembleContextFor(agent)` builds the per-agent assembly context (`agent` + `scope` together). `installModelSelection(agentCtx, selection)` snapshots a mutable provider/model/reasoning-effort selection during prompt assembly, applies its provider and model to prompt variables, and applies the complete selection to request routing for one step; an absent selected effort clears an inherited effort so adapter/provider defaults apply. `CreateAgentOptions.setup(agentCtx)` and `ResumeAgentOptions.setup(agentCtx)` compose a fresh or resumed agent's scoped world while both objects remain unpublished. Setup is trusted, composition-only same-process code: drive the agent only after creation resolves.

`AgentOptions` supplies the initial provider/model route and an optional positive `maxTokens` output cap. The concrete loop resolves any exact-model adapter default, records the effective cap in the request header, and applies it to each conversation-model request; an explicit Agent option wins, while omission leaves the adapter or provider route default in control.

- `ctx.agents.register(agent: Agent): () => void` — record an **already-constructed** agent. Disposed with the calling fiber.
- Advanced ordered lifecycle: `enter(agent, owner): () => void` enforces `agent.id === agent.session.id`, performs the authoritative ID collision check, and inserts without announcing; `owner` explicitly records the live creator-agent relation (or `undefined` for a root), independently of durable session lineage. `announce(agent)` emits `agent/created` exactly once. A detach requested synchronously by a creation listener is deferred until that dispatch unwinds, and every detach checks the captured entry object, so a stale capability cannot delete a later same-ID replacement. The async factory uses this split; ordinary plugins use `register()`.
- `ctx.agents.get(id: SessionId): Agent | undefined`
- `ctx.agents.isOwnedBy(id: SessionId, owner: Agent): boolean` — whether the exact live entry was created through that parent agent's scoped context; runtime ownership is independent of durable session lineage.
- `ctx.agents.list(): Agent[]`
- `ctx.agents.roots(): Agent[]` — live agents created without an owning agent context; a resumed lineage-bearing session can still be a runtime root.

#### Initiating Agent scope

`AgentLoop` runs each concrete driver's complete lifetime inside an initiator boundary. Concurrent drivers remain isolated: a child driver's continuations carry the child, while the parent continuation regains the parent as soon as `withInitiator()` returns; drain tracking continues until the child driver's Promise settles. Creation, persistence load, and unpublished setup remain outside the child's boundary, so setup initiated by a parent inherits the parent while `agentCtx.agent` identifies the child explicitly.

- `ctx.agents.currentInitiator(): Agent | undefined` — read the inherited initiator without requiring one.
- `ctx.agents.requireInitiator(): Agent` — read it or throw `no initiating agent is active`.
- `ctx.agents.withInitiator(agent, operation)` — run with one exact Agent and preserve the operation's exact synchronous value or Promise.
- `ctx.agents.withoutInitiator(operation)` — hide an inherited initiator for unrelated process-local work.

The scope carries the `Agent` itself and is process-local. Ambient presence is neither liveness proof nor authorization; explicit Agent fields remain authoritative at service, worker, process, persistence, and wire boundaries. Teardown rejects new boundaries, lets injected dependents and returned-Promise boundaries drain, then disables the underlying `AsyncLocalStorage`; unreturned work remains owned by the subsystem that detached it. If a boundary's inherited async chain starts an owning Cordis fiber's unload, that nested boundary chain is released from the drain so the unload cannot wait on itself; its continuations observe the disposed service after teardown. The [initiator-scope decision](../../../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md) owns the detailed boundary and teardown contract.

#### Factory API (creation)

Agent *creation* is provided by the plugin implementing `AgentFactory` (`dsh-agent-loop`), registered via `setFactory`. This keeps creation on the `dsh-agent` interface so consumers (UI, the ACP bridge) program against `ctx.agents` without depending on the concrete loop package. The registry canonicalizes an already traced Service to its concrete target and re-traces each call through the caller's context; this avoids nested Cordis shadows while passing an explicit caller-bound `ownerCtx` to plain factories.

- `ctx.agents.setFactory(factory: AgentFactory): () => void` — register the creation factory (the loop calls this on construction). Throws on a second factory; the slot clears on dispose.
- `ctx.agents.create(options: CreateAgentOptions): Promise<AgentHandle>` — create a session and agent, await optional setup while unpublished, then publish through final `SessionStore.enter()` and `AgentRegistry.enter()` checks. Concurrent same-ID creation is unsupported: more than one operation may prepare, but only one can enter; every loser rolls its private scope/session/driver back. An optional creation-only `signal` cancels unpublished setup and is detached before the handle is returned; later cancellation uses `handle.dispose()` or `agent.cancel()`. Publication is rollback-covered and every delivered creation edge is paired during rollback. Rejects if no factory is registered.
- `ctx.agents.resume(options: ResumeAgentOptions): Promise<AgentHandle>` — load a persisted session ([session persistence](../../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)), mint a fresh unpublished agent scope, await optional setup, and use the same final-entry publication sequence. Its optional `signal` is likewise creation-only. Rejects if no factory is registered or session persistence is unconfigured.

`AgentHandle = { agent: Agent; dispose(): Promise<void> }`. The disposer is a **consumer capability** — no observer holding the bare registry entry can tear the agent down. The caller fiber and the registered factory provider are structural co-owners: caller unload enforces structured ownership, while factory unload must stop old instances because their scoped dependency surface belongs to that provider. `dispose()` from any owner reaches one memoized quiescence boundary: it stops the loop, awaits its exit, unregisters the agent, removes its session from the store, and finally unwinds its scoped world. `ctx.agents.get(id)` still returns a bare `Agent`; the ACP bridge and in-process subagent backends hold consumer handles, while config-created agents are already owned by the loop fiber.

### Live events

`dsh-agent` declares the live `agent/*` coordination vocabulary so plugins do not depend on the concrete loop. Exact signatures, dispatch modes, scope-filtering rules, and payload contracts live in the generated region of [core.md](../../../docs/subsystems/core.md#cordis-surface); the [architecture turn flow](../../../docs/architecture.md#turn-flow) shows their order relative to durable session events.

The lifecycle edges have two important local caveats. `agent/created` runs after scoped setup and after both session and agent registry entries exist. Setup is trusted composition-only code; the immediately following non-vetoing `agent/session-start` notification is the first supported startup injection point. `agent/disposed` always means the exact agent has left the registry. AgentLoop emits it after its driver is quiescent, while ordered teardown may still be detaching the session and unwinding the scope; custom agents registered directly own any stronger driver-ordering contract themselves.

Most interception points are cooperative waterfalls. `agent/pre-step` receives a payload carrying the subject `agent`, the exclusive claimed `UserMessage[]`, and the proposed `turn`, `step`, and cancellation `signal`; its batch may be empty when tools already require another request. Agent-scoped turn extension points carry their explicit `AbortSignal` in the payload; the remaining turn-scoped extension points receive it through their request value. Listeners may cooperate with a signal but must not retain it as authority over another turn. `agent/request-error` is the failed-model-request recovery waterfall: it receives request coordinates, normalized failure facts, the serving registration's retry policy when available, and the signal. A listener returns `{ kind: 'retry' }` without calling `next()` when it owns recovery. `agent/turn-stopping` runs before an otherwise completed turn closes. The [explicit-cancellation decision](../../../.agents/notes/implemented/architecture/2026-07-16-explicit-turn-cancellation.md) owns signal lifetime; the [agent-scope runtime-design Agent Note](../../../.agents/notes/implemented/architecture/2026-07-12-agent-scope-runtime-design.md#three-execution-boundaries-are-deliberately-one-way) owns scoped dispatch and terminal settlement.

`PreStepDecision` is either `{ kind: 'reject' }` or `{ kind: 'enter', messages }`. The enter branch is the complete identified, frozen batch for the proposed step. A listener that wraps downstream entry preserves that batch unless it intentionally replaces it; additions follow the waterfall's natural return order. Claiming already removed the offered messages from the inbox, so rejection does not retain them. Messages inserted after the claim remain pending for a later boundary.

Inbox live notifications are deliberately per-message and minimal: `agent/inbox/inserted { message }`, `agent/inbox/claimed { message, turn }`, and `agent/inbox/discarded { message }`. They complement the durable `agent/inbox/spliced` projection without adding another lifecycle envelope.

Turn and step boundaries and the model token stream are durable `session/event` facts rather than mirrored `agent/*` notifications. Consumers read `turn/*`, `step/*`, and `assistant/chunk` from the session feed; tool policy and outcome observation belong to the complete pipeline documented by [`dsh-tools`](../tools/README.md).

`foldConsumedWork(events)` reads that feed back for the one question the turn sequence cannot answer alone: what became of the work a log consumed. It returns the latest `turn/end` that accounts for consumed work — a turn that entered a model step, or one that claimed inbox input and then failed, was stopped, or was rejected before reaching one — plus whether accepted work was later cancelled out of the inbox unrun. Both facts come from the log, so a cancellation reads the same whichever owner issued it. A no-step turn that took nothing, or emptied its claim and completed, describes no work and is skipped; a `blocked` end over claimed input is an account, because rejection discarded that input.

### Agent interface (`types.ts`)

The handle every plugin programs against:

- `agent.inbox` — the agent-owned projection of durable `agent/inbox/spliced` events. `nextTurn` and `nextStep` expose pending `UserMessage` values. `append`, `prepend`, `replace`, `remove`, `clear`, `splice`, and `claim` mutate them; `replace(messageId, newMessage)` and `remove(messageId)` locate the pending message across both lists. Replacement may change identity and publishes the old message as discarded followed by the new message as inserted. Ordinary removals and `clear()` are durable cancellations and emit `agent/inbox/discarded`. `claim(target)` removes the next proposed batch with pure deletion splices; the loop then emits `agent/inbox/claimed`. `MessageId` is the only occurrence identity and must remain unique while pending.
- `agent.followup(message)` — queue an ordinary `next-turn` message and wake the driver. It returns no completion handle; the message id identifies inbox insertion, claim, and discard facts, not a later output or `turn/end`.
- `agent.steer(message)` — queue waking `next-step` input. An idle agent starts a turn synchronously; a running driver consumes later steering at its next step boundary.
- `agent.inject(message)` — queue non-waking `next-step` context. A running driver claims it at the nearest later pre-step boundary; an idle driver leaves it pending until `followup()` or `steer()` wakes the driver. It may miss a request whose pre-step already claimed its batch.
- `agent.cancel(cause, options?)` — cancel the active driver and, unless `options.keepInbox`, durably cancel all pending inbox work. Idle cancellation is a no-op.
- `agent.whenIdle()` — observe whole-agent quiescence, including replacement work scheduled before the current driver retires. It does not settle any particular message.
- `agent.session`, `agent.status`, `agent.options`, `agent.id`, `agent.ctx`

`running` describes a driver-wide drain interval, not proof that a turn is still open; it can cover turn close, the durability checkpoint, and consecutive queued turns. Only a caller that owns a complete interval may summarize it as a run result ([decision](../../../.agents/notes/implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.md)).

### Extension points

- Agent creation: `AgentLoop.create()` is the concrete config-path implementation (in `dsh-agent-loop`), while programmatic consumers create/resume owned agents through `ctx.agents.create()` / `ctx.agents.resume()`. Replace the loop by implementing `Agent` and registering via `ctx.agents.register()`.
- Event listeners: all `agent/*` events are declared here — no dependency on the loop package needed.
- Subagent delegation is not an `Agent` method; providers create or drive ordinary handles through the factory API, so delegation transports stay outside the core agent interface.

## Model Experience

### User, steering, and injected messages

#### What the model sees

`send`, `steer`, and `inject` feed the owning session. `agent/pre-step` and other declared events let plugins reject a proposed step or add durable request material; this interface contributes no fixed prose itself.

#### Token effect

Accepted content becomes retained history or a repeated session prefix; blocked content contributes no request tokens. Size is caller- and plugin-dependent.

#### KV Cache effect

Accepted history and steering are append-only; a blocked submission sends no request. A session prefix remains stable within its loop instance, while a new or resumed instance may establish a different prefix.

### Agent-scoped request composition

#### What the model sees

Registrations through `agent.ctx` can shadow prompt sections or tools and can install agent-only interceptors during unpublished setup.

#### Token effect

The package adds zero tokens itself; scoped contributions affect only that agent and disappear on disposal.

#### KV Cache effect

Prefix-stable while an agent's scoped registrations are unchanged. Setup or reload that changes prompt sections, tool definitions, or request listeners may invalidate reuse from the first affected request token.

## Known Limitations and Deferred Work

- **Initiator scope is process-local** — workers, child processes, HTTP, durable queues, and restarts materialize any required identity explicitly.
- **Ambient identity may outlive liveness** — consumers still check `agent.status`, cancellation, and the owning capability contract before lifecycle-sensitive work.
- **Inter-agent channels beyond delegation** — shared state, streaming child output, and background/poll semantics remain outside the current synchronous `ctx.subagents` seam.
- **`agent/session-start` cannot gate startup** — it remains a synchronous, veto-less notification; async composition that must finish before publication belongs in the factory's `setup(agentCtx)` transaction instead.
- **`cancel()` clears the inbox by default** — it aborts the in-flight turn plus queued and steering work; `cancel(cause, { keepInbox: true })` aborts only the turn and preserves pending items. There is still no step-only abort that keeps the in-flight turn running ([stop API Agent Note](../../../.agents/notes/implemented/simplification/2026-06-20-public-agent-stop-api.md)).
- **Each additional `UserMessage` carries exactly one `MessageSource`** — contributions from several plugins merged onto one tool call collapse under one source, so the message cannot name several producers.
- **`SessionStartSource` reserves `'clear'`/`'compact'` with no emitter yet** — only `'startup'`/`'resume'` occur until the driving subsystems land (`TODO(compaction)`).
