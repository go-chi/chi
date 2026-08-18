# dsh-session

English | [中文](README.zh.md)

Event-sourced session log and in-memory store. A `Session` is the append-only source of truth for an agent's whole interaction history — the LLM message history is *derived* from it. A **surface** layer (an ordered projection of message-producing events) is maintained on top of the raw log for efficient derivation and compaction.

The optional `@deepseek-ai/dsh-session/invariant` companion registers this package's relational trace checks with `ctx.invariants`: monotonic sequence numbers, turn/step enclosure, and same-step tool call/result pairing. It replays existing sessions when loaded or reloaded; storage validation, snapshotting, freezing, cited source-event validation, and surface acceptance remain always-on responsibilities of the root session package.

## Service: `SessionStore` (ctx key: `sessions`)

Creates and holds event-sourced `Session` instances. Persistence is intentionally not implemented here — plugins subscribe to `session/event`, flush on `session/flush`, and may mirror the paired `session/created`/`session/disposed` lifecycle.

### Public API

- `ctx.sessions.create(id?, { seed?, meta? }?)` validates and detaches durable seed/header data, fills the version and id, defaults `createdAt` to now, publishes the session, and binds it to the calling fiber. Persisted reconstruction supplies its original `createdAt`, `seedLength`, and `delegationDepth`.
- `ctx.sessions.flush(session)` dispatches the awaited parallel durability checkpoint through the session's captured scope. Every listener starts and the call waits for all to settle before reporting failure; unpublished, detached, and stale objects reject.
- `ctx.sessions.fork(source, boundary?, childSessionId?): Session` — Resolve a live session object or id, select a seed through the inclusive `boundary` event seq (default: current last event), require that prefix to end outside an open turn, and create a live child session with lineage metadata.
- `ctx.sessions.get(id: SessionId): Session | undefined`
- `ctx.sessions.list(): Session[]`

#### Advanced: ordered-teardown lifecycle primitives

Use the split lifecycle only when teardown must be ordered with another resource:

- `prepare(id?, options?)` validates and constructs without publication.
- `enter(session)` performs the collision check, publishes without announcing, and returns an entry-bound idempotent detach. Concurrent same-id preparations are allowed, but only one entry succeeds; a stale detach cannot remove its replacement.
- `announce(session)` emits the single creation edge and rejects repeat or reentrant announcements. Detach during that dispatch is deferred and later emits the paired disposal edge; an unannounced entry emits neither lifecycle edge.

`dsh-agent-loop` uses this split so final loop flush precedes session detach; see the [ownership Agent Note](../../../.agents/notes/implemented/architecture/2026-06-18-agent-lifecycle-and-ownership-contracts.md).

### Live service events

The store pairs announced creation with disposal, publishes post-commit append notifications with per-listener containment, and provides an awaited durability checkpoint. Exact signatures and scope behavior live in the generated region of [session.md](../../../docs/subsystems/session.md#cordis-surface); payloads live in the [persistence catalog](../../../docs/persistence-catalog.md).

### Class: `Session`

Plain class (not a Cordis Service). Create live sessions through `ctx.sessions.create()` and detached replay or inspection sessions through `Session.create()`; the detached factory does not publish lifecycle events or bind the session to a fiber.

- `session.append(type, data, opts?)` snapshots and freezes durable data and surface metadata, validates marker shape, cited source-event seqs, complete replacement coverage, and content-only single-result `tool/result` rewrites, commits synchronously, then notifies observers with independent failure containment. Reentrant attached-session appends reject, and runtime checks cover widened unions and loaded logs.
- `session.deriveMessages()` incrementally projects each new surface entry once and returns a fresh array over the complete identified, frozen messages stored by those entries. Assistant messages preserve the provider and model that produced them plus adapter-private replay state in their model source. A surface rewrite rebuilds the projection; there is no raw-log fallback.
- `session.deriveEventMessage(event)` is the canonical per-event projection used by reconstruction and request checks.
- `session.surface` exposes the readonly `SessionSurface` view owned by the session's single incremental surface manager; `replaceGeneration` changes on every committed rewrite.
- `session.events` is a cached frozen snapshot invalidated by append; accepted events remain deeply frozen.
- `session.seq`, `session.id` — current sequence and readonly typed identity.
- `session.header: SessionHeader` — detached, deep-frozen creation metadata (`version`, `id`, `createdAt`, optional `cwd`/`parentSession`/`seedLength`/`delegationDepth`). Construction validates the durable record and requires its id to match `session.id`.

### Lossless JSON utilities

Durable values need one accepted representation, not a check followed by a second read. `isJsonValue(value)` is the boolean predicate; `snapshotJsonValue(value)` iteratively validates and copies a plain value in one pass, returning `undefined` for invalid input and propagating a throwing getter. The snapshot helper accepts finite JSON numbers except `-0` (JSON rewrites it to `0`), dense ordinary arrays, and plain or null-prototype objects; it rejects cycles, unsupported scalars, and exotic prototypes before normalization without imposing a call-stack depth limit.

Session-event import separates ownership from message validation. `snapshotSessionEvent(event)` clones a borrowed event before validating and freezing its identified message. `adoptSessionEvent(event)` performs the same message work in place and returns the original event; callers may use it only when they transfer an exclusively owned object graph with no mutable child shared with another event.

### Chunk-row storage codec (`chunk-rows.ts`)

The shared [storage codec](src/chunk-rows.ts) losslessly converts event sequences to compact rows and back. It preserves unrecognized events verbatim and rejects malformed encoded rows; persistence backends decide whether to enable packed writes.

### Surface types

This package owns ordered surface projection, replacement validation, replay, and the type guards that distinguish append-origin from replacement events. The [surface type catalog](../../../docs/subsystems/session.md#surface-types) owns the exact shapes and field semantics. A human transcript must project append-origin events rather than `session.surface`, because landed replacements shadow history the reader already saw; model-facing consumers continue to read `session.surface`.

### Request-header reconstruction (`request-header.ts`)

`request/header` records a full canonical snapshot of the non-history request envelope with reason `initial`, `resume`, or `change`. Its optional `adapterDefaults` map marks effective `reasoningEffort` or `maxTokens` values materialized by exact-model resolution, allowing the next request proposal to distinguish them from explicit conversation settings. `foldRequestHeader()` selects the latest snapshot; legacy delta events and the removed `fallback` reason are rejected. See the [reconstructable-requests Agent Note](../../../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md).

A `user/message` stores the complete `UserMessage` directly, including the identity created before inbox routing or step entry. It renders its `content` verbatim whether it is a direct human prompt, a synthetic injection, or an entered goal round; its typed `source` is the only channel that tells them apart and carries any domain-specific durable facts. `assistant/message` and `tool/result` likewise store complete message values. Turn execution remains enclosed by `turn/start` and `turn/end`; `agent.inject()` queues input until a later pre-step claims it and returns it in an enter decision.

`tool/result` persists one identified user-role tool-result message, optional internal failure identity, and optional presentation metadata. A tool's successful canonical `value` and human-readable canonical failure message remain execution-local; rendered error content is the replay-authoritative message.

### Session event vocabulary (`types.ts`)

The generated [persistence log event catalog](../../../docs/persistence-catalog.md) enumerates each append-only event type with its payload, surface badge, and declaration site. Token accounting reads per-step `assistant/chunk { type: 'usage' }` records and treats `assistant/message.usage` as the committed-step fallback when no usage chunk exists; failed model-request attempts have no assistant message. Each `assistant/message` records the provider, model, and optional replay state.

Merge-extensible via `SessionEventMap` — a plugin declaration-merges its own types (the compaction seam's `compaction/*`, bounded recovery's non-surface `llm/retry`, the hook bridges' `hook/*`); merged members appear in the same catalog. A plugin owns the relational invariant for its merged events, including whether a log-only event may appear between turns. A producer that requires durability appends through `Session` and then awaits `ctx.sessions.flush(session)` without fabricating an execution turn.

Also defines `TurnEndReasonMap`, the merge-extensible `kind`-tagged sum type for turn endings. `turn/start` carries only the turn number; the following entered `user/message` batch records its input, while `llm/retry` records request recovery.

An interrupted live turn ends with `{ kind: 'aborted', reason: AgentCancelCause }`, preserving the typed cancellation cause in the durable transcript. Persistence imports the coarse aborted outcome from the supported older format as `{ kind: 'aborted', reason: { kind: 'legacy' } }`, because that record did not retain its caller. A turn failure carries `{ kind: 'error', error }`; crash recovery alone synthesizes `{ kind: 'interrupted' }`.

Every `SessionEvent` carries three optional top-level fields (structural metadata):

- `sourceEventSeqs?: number[]` — seq numbers of earlier events cited as sources (e.g., the `assistant/chunk` seqs behind an `assistant/message`, or the shadowed entries behind a compaction replacement entry). On `assistant/message`, a present `[]` records a known empty provider stream, while omission means a legacy or foreign event did not record the source stream; other surface events require a non-empty list when this field is present.
- `surfaceOp?: SurfaceOp` — how this event entered the surface. Absent for non-surface events (boundaries, chunks, usage, errors).
- `ignorable?: true` — marks an event a reader may safely skip when it does not recognize the type; absent means required, so an unknown-type event refuses session reconstruction ([mechanism](../../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)).

### Metadata types (`types.ts`)

- `SessionHeader` — session metadata written once when published as `Session.header`, where detachment and deep-freezing enforce immutability at runtime: `{ version, id, createdAt, cwd?, parentSession?, seedLength?, delegationDepth? }`. Persistence loaders may return mutable detached copies of the same data type. Owned here (beside `SessionId`) because `Session.header` is typed by it; persistence backends re-export it rather than own it (which would force a package cycle).

### Extension points

- Persistence plugins: subscribe to `session/event` (write-behind) and drain on `session/flush` (awaited) and fiber dispose. A durable backend reads the log and reloads it into a live session; the metadata contract (`SessionHeader`, `session.header`) is what such a backend stores beside the log.
- Replay/fork: `create(id, { seed })` validates and freezes a contiguous current-format log and rebuilds its surface; request headers require provider/model, and assistant messages require provider/model provenance. Persistence owns read compatibility before constructing this current-format seed. `fork(source, boundary?, childSessionId?)` selects a completed-turn prefix and records lineage.
- Compaction: `dsh-compaction-basic` appends a `user/message` replacement for summary checkpoints, while `dsh-compaction-tool-result-pruner` appends a content-only `tool/result` replacement. Tool-pairing boundary policy and its cache belong to the [`dsh-compaction` seam](../../compaction/compaction/README.md), while this package owns ordered surface membership, replacement validation, and `replaceGeneration`.

## Model Experience

### Derived message history

#### What the model sees

The model receives the complete messages from `user/message`, `assistant/message`, and `tool/result` surface entries verbatim. Their identities, roles, sources, and content blocks are the same values established at creation; projections do not mint identities. A prompt envelope changes only human presentation; its prefix context and request delimiter are already present in the event content. Tool calls live inside assistant messages. Chunks, boundaries, usage, hook records, todo records, and other log-only events add no message.

#### Token effect

Appended surface entries are resent on later steps. A `replace` surface operation removes the shadowed entries from future inputs without deleting their raw log records.

#### KV Cache effect

Appended surface entries preserve reusable prefixes. A `replace` operation invalidates reuse from the first shadowed message even though the underlying event log stays append-only.

### Crash-repair result

#### What the model sees

If recovery finds an assistant tool request with no durable `tool/call`, its synthetic `TOOL_NOT_STARTED` result says `The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.` If a durable `tool/call` has no result, its `TOOL_OUTCOME_UNKNOWN` result says `The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.`

#### Token effect

Zero tokens in an intact session. Each repaired call adds its retained risk-specific error text on resume.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Logged request header

#### What the model sees

The session reconstructs the system prompt, tool schemas, call config, and session prefix that the loop actually sent. Header events do not add a second copy to message history; the prefix is prepended outside `deriveMessages()`.

#### Token effect

Zero duplicate tokens from logging. The reconstructed prefix, system text, and schemas still incur their normal per-request cost.

#### KV Cache effect

Logging causes no invalidation, and exact reconstruction preserves request-prefix identity. A later header with changed prefix, prompt, or schemas may invalidate reuse from its first difference.

## Known Limitations and Deferred Work

- **Session branching/tree** (pi-style entry tree) — deferred unless needed beyond boundary-based `fork()`.
- **`fork()` cuts only at stable boundaries of live sessions** — the selected prefix must end outside an open turn and the source must be in the store; forking a persisted-but-unloaded session is excluded from the [fork API](../../../.agents/notes/implemented/feature/2026-06-30-session-store-fork-api.md).
- **`SESSION_FORMAT_VERSION` stays pinned at `0`** — pre-release, no broad compatibility implied: `Session` accepts only current seed shapes, and a backend refuses any other version naming the direction (newer: "written by a newer harness — upgrade"; older: no upgrade path ships yet). Unknown event types refuse the same way unless marked `ignorable` in the envelope; the versioning mechanism is the [session-log-version-mechanism note](../../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md). Narrow storage import upgrades belong to the persistence boundary ([policy](../../../AGENTS.md), [pre-identity message recovery](../../../.agents/notes/implemented/bug-fix/2026-07-28-load-pre-identity-session-messages.md)).
- **`TurnEndReasonMap` omits the ACP-named `refusal` / `max_turn_requests` variants** — producer-gated: they land when an adapter or the loop first emits them.
