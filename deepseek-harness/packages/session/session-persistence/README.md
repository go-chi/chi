# @deepseek-ai/dsh-session-persistence

English | [中文](README.zh.md)

Session persistence is a capability seam. The abstract `SessionPersistence` service (`ctx.sessionPersistence`) is its Service Definition. It requires a persistence backend to store, reload, and list sessions durably without defining the storage implementation. The seam follows the `dsh-shell` roles ([capability seams](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)): this package owns the Service Definition, a sibling package owns the Service Provider, and Consumers inject the service.

The persisted unit IS the existing `SessionEvent` (event-sourced model — the log is the single source of truth), so there is no parallel "persisted message" type. Metadata that is NOT replayable conversation state (format version, cwd, lineage, seed boundary, origin, delegation depth) travels separately as `SessionHeader`, owned by `dsh-session` and re-exported here.

## Service API (`ctx.sessionPersistence`)

| Method | Contract |
|---|---|
| `locate(meta): SessionLocation \| undefined` | Resolve an absolute per-session artifact target without I/O or materialization. Backends without an independent local artifact return `undefined`. |
| `supportsRawArtifacts: boolean` | State explicitly whether this backend exposes one verbatim artifact per session. Consumers check this capability before calling `readRaw`; `false` is not session absence. |
| `readRaw(id, signal?): Promise<SessionRawArtifact \| undefined>` | Read a supported backend's own artifact text verbatim, decoded from its physical encoding but never reconstructed from events. `undefined` means only that the requested artifact is absent; an unsupported backend rejects. |
| `create(meta): Promise<void>` | Register a new session's metadata. MAY defer the physical write until the first `append` (lazy materialization). |
| `append(id, events): Promise<void>` | Durably persist a batch. Append-only; first event `seq` == stored next-seq after any repair; rejects non-JSON-serializable data naming the offending type. |
| `prepare(id, signal?): Promise<SessionPreparation>` | Reserve the exact unpublished Session used by resume. A coordinator reuses an earlier inspection when available, commits pending recovery, and releases an unpublished reservation back to its bounded cache on disposal. |
| `load(id): Promise<{ meta; events }>` | Return an immutable balanced logical log after converting supported older records from the same format version and committing cold recovery. A live load first flushes its snapshot and rejects while its turn is open; a cold load preserves an interrupted final turn and durably closes it with synthetic `tool/result`/`step/end?`/`turn/end {interrupted}` events. Only a torn tail fragment is dropped; committed corruption and malformed records reject as `SessionPersistenceCorruptionError`, while an unsupported format `version` or an event type unknown to this build (without the envelope's `ignorable` marker) refuses as `SessionFormatUnsupportedError`, naming the refusal direction and the raw log path when the backend keeps one artifact per session. |
| `inspect(id, signal?): Promise<{ meta; events }>` | Return an upgraded, validated, deeply frozen logical view without committing recovery or publishing a Session. A cold view receives in-memory synthetic recovery closers while its physical torn tail remains untouched; an already-live view is its current immutable snapshot and may contain an open turn. Coordinator-backed implementations retain the exact cold unpublished Session in a bounded LRU for later `prepare`, but discard and reload it when the stored revision changes. Same-id inspections share an in-flight read. |
| `readFrom(id, fromSeq, signal?): Promise<{ meta; events }>` | Return valid stored events with `seq >= fromSeq` without preparation caching, truncation, closers, or coordinator state. A `fromSeq` at or past the stored end returns an empty event list; a negative or non-safe-integer `fromSeq` rejects. Seek-capable backends (SQLite) read only the suffix unless converting a supported older record requires earlier records; sequential backends (JSONL) parse the whole artifact and skip forward. Unknown-type refusal follows that access pattern: a seek read checks only the returned suffix, while the sequential fallback also refuses on an unknown required event below the window. Intended for checkpoint consumers that apply only events after a stored sequence number. |
| `list(signal?): Promise<SessionHeader[]>` | Lightweight listing from metadata, no full-log parse. The optional signal cancels backend listing work. A zero-event lazily-materialized session is absent from `list`. |
| `listSnapshots(signal?): Promise<SessionPersistenceSnapshot[]>` | Lightweight metadata plus an opaque branded per-log revision, without loading event logs. A revision stays equal while that log and its backing store are unchanged, changes after append or mutating load repair, and cannot collide solely because two stores use the same local counter. The optional signal requests cancellation of backend discovery work; first-party backends settle any started listing work before rejecting so an awaited call is quiescent. |

## Invariants every backend must honor

- **Append-only; a crashed turn is closed, not truncated.** Flushed events are never rewritten. A crash can leave an unclosed final turn whose events are real and possibly large; `load` preserves them and durably appends synthetic closers (a risk-classified error `tool/result` per unanswered assistant call, then `step/end?`+`turn/end {interrupted}`) to balance the log and keep the rehydrated history a valid provider transcript. Only a never-fully-written torn tail fragment is discarded.
- **Contiguous seq.** `load` rejects a `seq` gap/parse error in the MIDDLE of the log; `append`'s first `seq` must equal the stored next-seq.
- **JSON-serializable data.** `append` materializes each direct/replay batch through the shared one-pass lossless-JSON boundary. Live `Session` events are already deep-frozen, but the write coordinator still copies each event into a persistence-owned buffer.
- **Durability.** `append` returns only once the batch is durable.

## The write coordinator

`PersistenceCoordinator` owns per-id state and serialization, one bounded write controller per live session, lazy materialization, crash-tail repair, session adoption, and quiescent disposal. A first-party backend composes one, implements the small `PersistenceBackend` storage hook interface, and delegates its stateful methods. JSONL and SQLite therefore share lifecycle correctness while retaining different storage primitives; see the [coordinator Agent Note](../../../.agents/notes/implemented/architecture/2026-06-18-shared-persistence-write-coordinator.md), [flush-controller simplification](../../../.agents/notes/implemented/simplification/2026-07-23-collapse-persistence-flush-state.md), and [bounded batching decision](../../../.agents/notes/implemented/architecture/2026-08-08-bounded-session-persistence-write-batching.md).

Each `session/event` copies its event into the session controller. The first pending event starts a fixed batching window; later events join without resetting its deadline. The configured `writeBatchMaxDelayMs` bounds this intentional wait, not event-loop, initialization, serialized-operation, or backend latency. Events admitted during a write form a new bounded batch. `session/flush` cancels the wait and is a shared quiescence barrier that drains events admitted while it runs. A background failure is logged once, retains the ordered batch, and pauses automatic retry; a new event starts a fresh window, while explicit flush or backend teardown retries immediately and surfaces a repeated failure.

Crash repair is cold-only. For a live id, `load(id)` snapshots the authoritative in-memory log, waits for that snapshot to become durable, and returns it only when balanced; an open live turn rejects instead of receiving synthetic interruption closers. For a cold id, inspection reads, validates, freezes, and constructs one unpublished Session; repeated inspection reuses that object graph only while its source revision remains current. `prepare(id)` performs the same check before repair, reserves the exact Session, commits any pending torn-tail/interrupted-turn repair, and returns it for publication. HMR adoption reads through `loadStored`, applies the coordinator's cwd check, and never closes the active turn.

Backend reads convert the exact supported older records from the same format version before validating current records. Pre-identity messages receive the deterministic id `legacy-message:<session-id>:<event-seq>`; a tool-result content replacement inherits its target's imported id. A pre-react-loop `turn/start` loses its obsolete trigger, a removed `steering/message` becomes the same identified `user/message`, and an older `turn/end` maps its terminal reason without inventing a caller that the old record did not name. The coordinator uses the same converted view for `load`, `inspect`, `readFrom`, ownerless-state claims, and HMR prefix adoption. Storage remains append-only: reads do not rewrite old records, and later appends use the current format. These are narrow import exceptions from the [pre-identity message](../../../.agents/notes/implemented/bug-fix/2026-07-28-load-pre-identity-session-messages.md) and [pre-react-loop session](../../../.agents/notes/implemented/bug-fix/2026-08-04-load-pre-react-loop-sessions.md) decisions, not a general v0 migration promise.

When a live session emits `session/disposed`, the coordinator waits for its controller, serializes a final drain, then releases state owned by that exact `Session` object. Failed retirement leaves the controller in the live-session map, so backend teardown can retry it. Backend teardown stops event admission first, flushes every remaining controller, awaits per-id operations, and only then closes the storage handle.

The side-effect-free `locate`, lightweight `listSnapshots`, and per-id `readStoredRevision` queries remain backend-owned because they describe storage topology and revision identity rather than write orchestration. `listSnapshots(signal?)` passes the caller's exact signal into backend discovery so observers can cancel that work without detaching it.

The `PersistenceBackend<TornMarker>` hooks (the only contract between the coordinator and storage):

| Hook | Role |
|---|---|
| `name` | Backend label for the dispose-failure `AggregateError`. |
| `loadStored(id, signal?)` | Read a stored prefix by id across every storage scope. Used by resume/load, non-mutating inspect, live adoption, and the create-collision probe. The optional signal belongs to observation-only reads. Returned metadata identifies `id`; `revision` identifies exactly the returned header and events; an opaque `tornMarker` is present iff a torn tail must be truncated. |
| `readStoredRevision(id, signal?)` | Read the current source-qualified revision for one id without loading its event log. It uses the same revision representation as `loadStored` and returns `undefined` when the id is absent. |
| `loadStoredFrom?(id, fromSeq, signal?)` | Optional seek-capable suffix read behind the service's `readFrom`: the header plus stored events with `seq >= fromSeq`, non-mutating, no torn marker. SQLite implements it (`WHERE seq >= ?`); a backend that omits it gets the coordinator's fallback — `loadStored` plus a forward skip. |
| `appendBatch(meta, events, isMaterialized)` | Durably append a contiguous batch, lazily materializing ATOMICALLY when not yet materialized. |
| `commitRepair(meta, tornMarker, closers)` | Make a crash repair durable: truncate the torn tail (iff `tornMarker !== undefined` — a marker may be falsy, e.g. seq/offset `0`) and append `closers`. NOT required to be atomic. Used by load (truncate + closers) and live-adoption (truncate only). |
| `list(signal?)` | List all stored metadata, observing optional cancellation. |
| `close?()` | Optional lifecycle teardown (e.g. close a db handle), awaited after the dispose drain. |

The coordinator asserts the stored id and compares stored/live cwd before repair or live adoption. Its `inspect()` path takes ownership of fresh backend values, validates and freezes them once, and retains at most the configured number of unpublished Sessions without calling `commitRepair`. A retained source is reused or repaired only when its revision still equals `readStoredRevision`; otherwise the coordinator reloads it. This freshness check does not add cross-process writer exclusion. Revision retries converge when the durable log remains unchanged for one read/check round trip; continuous external writers can delay `load`, `inspect`, or `prepare`. The `tornMarker` is fully OPAQUE: the coordinator only tests `!== undefined` and round-trips it to `commitRepair`, never inspecting its value (the JSONL backend uses the byte offset to truncate to, the SQLite backend the seq to delete from). A third-party backend MAY implement the abstract service directly without the coordinator, but it must provide the same non-mutating inspection and trustworthy lightweight snapshot revisions. See [the write-coordinator Agent Note](../../../.agents/notes/implemented/architecture/2026-06-18-shared-persistence-write-coordinator.md).

## Metadata and location types

Re-exported from `dsh-session`: `SessionHeader` (immutable session metadata: `version`, `id`, `createdAt`, `cwd?`, `parentSession?`, `seedLength?`, `origin?`, `delegationDepth?`). `SessionLocation` is `{ readonly kind: string; readonly path: string }`; its path is an absolute backend target, not proof that the artifact exists or contains an unflushed turn.

## Model Experience

### Resumed conversation history

#### What the model sees

This seam adds no prompt or schema. Resume restores stored surface events as message history; stored request headers reconstruct earlier calls, while the new loop composes the current system prompt, tools, and session prefix for its next request. Crash repair marks an assistant request without a durable call as `TOOL_NOT_STARTED`; a durable call without a result becomes `TOOL_OUTCOME_UNKNOWN`, whose text lets the model retry read-only or idempotent work but directs it to verify side effects or ask the user instead of retrying blindly.

#### Token effect

Zero tokens during ordinary persistence. Resume restores retained history cost and pays the current request envelope normally; each repaired call adds the quoted retained error text.

#### KV Cache effect

Persistence does not mutate live request prefixes. A resumed loop can reuse provider cache only when its reconstructed history, current envelope, and model route match; crash-repair results append without rewriting earlier history.

## Known Limitations and Deferred Work

- **No deletion or retention API** — pruning stored sessions is out-of-band backend maintenance.
- **`list()` is unpaginated and unfiltered** — it returns every stored session's header; fine for local stores, unindexed at scale.
- **Repair-time synthetic closers are the only crash story** — a backend must synthesize `tool/result`/`step/end`/`turn/end` closers on load; there is no partial-turn resume that continues an interrupted turn instead of closing it.
