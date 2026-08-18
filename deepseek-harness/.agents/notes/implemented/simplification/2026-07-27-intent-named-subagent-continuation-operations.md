# Agent Note: Intent-named subagent continuation operations

Status: implemented

English | [中文](2026-07-27-intent-named-subagent-continuation-operations.zh.md)

The current activation-based realization is owned by [Continuable subagents](../feature/2026-07-28-continuable-subagent-conversations.md). It retains the `followup` operation this record names, returns the accepted `MessageId`, uses the bare `Agent` parameter as exact live-direct-parent authority, and limits provider participation in continuable children to `prepareContinuable`.

## Problem

Merging continuable-child orchestration into `ctx.subagents` left provider dispatch and caller intent on the same public service. `resume(name, request)` accepted a descriptor, authorized parent, durable child id, and activation signal that only the internal continuation manager could resolve correctly. `sendMessage(...)` exposed transport wording rather than the `followup` intent already used by `Agent`, and its separate source and signal parameters widened an operation every caller had to use atomically.

The durability boundary also exposed both `SessionStore.flush()` and `flushRequired()`. They performed the same scoped parallel dispatch and differed only in whether an empty listener snapshot was accepted, so the session interface encoded one consumer's policy as a second operation.

## Decision

`SubagentRuntime` separates four execution intents: `start(name, request)` returns an ordinary holder-owned one-shot run; `startContinuable(spec)` establishes a durable child and returns its id plus the accepted initial `MessageId`; `followup(parent, childId, content, { source, signal })` sends later parent content; and `reportFrom(child, content, { delivery, signal })` sends selected child content to its direct parent. `followup` matches `Agent.followup()`, while `SubagentRun.steer()` remains the narrower confirmed live-run capability. The model-facing tools keep their stable `send_message` and `report` names and delegate routing to the corresponding intent methods.

Caller and provider requests are distinct. `SubagentStartRequest` contains caller-supplied one-shot data; `ResolvedSubagentStartRequest` adds the service-resolved descriptor before `SubagentProvider.start()`. For continuable creation, the manager passes a `ContinuableCreateRequest` to optional `SubagentProvider.prepareContinuable()` and receives detached creation data only. `SubagentRuntime.resume()` and provider resume dispatch are absent: the continuation manager loads the descriptor, authorizes the parent, and owns Agent materialization, prompt delivery, cold resume, and teardown.

`SessionStore.flush(session)` is the single durability barrier and returns `Promise<boolean>`. It resolves `true` after at least one scoped listener participates successfully, resolves `false` for an empty listener snapshot, and rejects with the first registered listener failure after all listeners settle. Participation cannot identify whether a selected persistence backend stored the state. Ordinary checkpoints may ignore the boolean; the continuation manager also treats its final flush as a best-effort barrier, deliberately ignores participation, logs rejection, and still disposes the child and releases ownership.

## Alternatives considered

**Keep public provider resume dispatch.** No production caller outside the continuation manager owns descriptor lookup, direct-parent authorization, Agent materialization, Activation ownership, and child-first teardown. A public method would expose resolved implementation data without a valid independent intent; providers instead contribute detached first-creation data through `prepareContinuable` and never participate in cold resume.

**Keep `sendMessage` on the service.** The model tool sends a message, but the service operation represents a follow-up that may steer or cold-resume. `followup` aligns with the structural `Agent` interface and does not promise a particular route.

**Keep `flushRequired()`.** A second method hides only an empty-listener check. Returning participation from the existing barrier keeps dispatch in one implementation and lets each caller state whether absence is acceptable.

**Fold ordinary and continuable starts together.** A flag would make one method return either an awaited holder-owned one-shot run or immediate durable child and message identities. Separate intent methods preserve the ownership and timing distinction without a return union.

## Consequences

- The Cordis service catalog contains only caller operations; a provider can opt into continuable first creation through `SubagentProvider.prepareContinuable?()` without receiving Agent lifecycle authority or a public resume operation.
- Follow-up source and cancellation travel in one options object, matching the intent-helper shape on `Agent` while retaining the existing live-delivery and cold-resume semantics.
- Session durability has one barrier operation. Its participation result remains observable, but no continuable-child path treats arbitrary listener participation as proof that a persistence backend stored the state.
- The `send_message` and `report` schemas, accepted message identities, `AgentHandle` ownership, durable event vocabulary, and model-visible transcript follow the activation-based realization linked above.
