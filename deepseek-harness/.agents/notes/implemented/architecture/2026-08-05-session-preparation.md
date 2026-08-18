# Agent Note: Reusable Session preparation before publication

Status: implemented

English | [中文](2026-08-05-session-preparation.zh.md)

## Problem

Cold history inspection and Agent resume independently materialized the same persisted session log. For a large compressed log, each operation repeated the full read, decompression, parse, validation, freezing, and Session construction. Pagination could therefore pay the cold-read cost again, while making a history query activate an Agent would couple a read lifecycle to a live Agent with no natural retirement point.

Fresh creation and persisted resume also reached the same publication boundary through different construction flows. This obscured the invariant that setup must finish against one unpublished Session before that exact Session and its Agent become visible together.

## Decision

`SessionPreparation` owns one exact unpublished `Session` until publication or rollback. It is a Session lifecycle object, not an Agent lifecycle or activation object. Fresh creation wraps the result of `SessionStore.prepare()`; persisted resume obtains a preparation from `SessionPersistence.prepare()`.

The Agent loop consumes both forms through one setup-and-publication pipeline: it acquires the preparation, builds the private Agent context around `preparation.session`, awaits optional setup, publishes that exact Session and Agent, and disposes the preparation on every exit. Publication transfers the live lifecycle to the existing Session and Agent stores; `SessionPreparation` itself owns no Agent behavior.

This refines the publication boundary from the [Agent lifecycle and ownership decision](2026-06-18-agent-lifecycle-and-ownership-contracts.md) without replacing its ownership model.

## Persisted preparation lifecycle

A coordinator-backed persistence implementation loads one cold source into a prepared Session. The backend transfers fresh, mutually unaliased metadata and events together with the source-qualified revision that identifies those exact values; the Session restore path validates and freezes the graphs in place instead of cloning them. The coordinator computes interrupted-turn closers and constructs the exact unpublished Session once. Its immutable header and balanced logical event log form the `SessionInspection` borrowed by readers, while the revision remains internal to persistence.

`inspect(id, signal?)` does not mutate storage. Synthetic closers exist only in the prepared in-memory view, and a torn physical tail remains untouched. Same-id callers share an in-flight cold read. Once ready, the preparation may remain in a per-coordinator LRU whose capacity defaults to five and is configurable by first-party backends. Before reusing a retained source, the coordinator reads that id's current revision; a mismatch evicts a ready source and repeats the cold materialization. A source already committing or reserved for resume remains exclusively owned, so concurrent inspection borrows that immutable view until publication or release.

`prepare(id, signal?)` exclusively reserves the prepared Session. It confirms the retained revision before committing any torn-tail and interrupted-turn repair, establishes the durable cursor, then returns a disposable preparation. A stale source is discarded and reloaded instead of being repaired or published. A successful repair also discards the pre-repair source and materializes the committed log again before reservation, so a newer revision is never associated with an older event graph. Another same-id preparation waits until the reservation is published or released. Publication accepts only the exact reserved Session and attaches the committed cursor without rebuilding its history. Failed setup or cancellation returns an unchanged unpublished Session to the LRU; mutation or attachment consumes the reservation.

The legacy `load(id)` API uses the same preparation and repair machinery, then discards its reservation and returns the immutable logical view. It remains a compatibility API, not the history-to-resume reuse path. This lifecycle extends the [shared persistence coordinator](2026-06-18-shared-persistence-write-coordinator.md) while preserving the storage and recovery rules owned by the [session persistence decision](2026-06-14-session-persistence.md).

## History and resume reuse

History reads use `inspect()`, so repeated pages borrow the same immutable prepared state without activating an Agent. A later resume uses `prepare()` and receives the exact Session retained by inspection; it does not read, decompress, parse, clone, validate, or freeze the complete log again.

If the durable log changes after inspection, its revision changes. The next history read or resume discards a retained ready Session and materializes the new log, so an old event graph cannot be associated with a newer snapshot revision. A source already claimed by an in-flight resume is not evicted: its exclusive owner keeps it through publication or release, and concurrent history may borrow the same immutable view.

Cold continuable-subagent access follows the same path. Descriptor authorization first inspects the child, then `ctx.agents.resume()` reserves and publishes the retained Session. This preserves the lifecycle and authorization rules in the [continuable subagent conversation decision](../feature/2026-07-28-continuable-subagent-conversations.md) while removing its duplicate cold read.

## Boundaries

- `readFrom()` remains a detached physical-suffix API. It neither creates nor consumes a preparation, synthesizes logical closers, or joins the LRU.
- HMR adoption keeps the live Session authoritative and reads the stored prefix directly. It may truncate a torn physical fragment but never closes the live open turn as interrupted.
- The cache belongs to one persistence coordinator, not a process-global Session map. Live Sessions are owned by the existing stores and never occupy preparation capacity.
- A fresh create never claims a cold persisted preparation with the same id. Persistence collisions continue to reject.
- Third-party persistence implementations retain the abstract `prepare()` fallback through `load()`. They receive the same publication interface but gain exact-object reuse only when they override preparation.
- Revision validation establishes freshness at the reuse and repair-commit points; it does not add cross-process writer exclusion to a backend. Retries converge after the durable log remains unchanged for one read/check round trip, so continuous external writers can delay preparation.

## Verification

The shared persistence contract pins non-mutating balanced cold inspection and later repair. `persistence.spec.ts` and `preparations.spec.ts` pin same-id in-flight sharing, exact Session reuse across inspect and prepare, revision-triggered refresh before history and resume, single repair commit, exclusive reservation, release after failed setup, ready-entry LRU eviction, append rejection during reservation, and publication of only the reserved Session. Backend tests pin that full and lightweight reads use the same revision identity. Agent-loop and continuable-subagent tests pin the common publication pipeline and inspection-to-resume path across cancellation and teardown.

## Alternatives considered

**Activate an Agent for history reads.** Rejected because pagination would keep query-only Agents live and transfer cache retirement into the Agent lifecycle.

**Cache only `{ meta, events }`.** Rejected because resume would still reconstruct, validate, freeze, and copy a Session from the cached values. The exact unpublished Session is the reusable unit.

**Keep a process-global Session map.** Rejected because it would cross backend and runtime ownership boundaries, retain unbounded identities, and duplicate the live Session store.

**Add a restore transaction or coordinator to the Agent loop.** Rejected because cold reading, repair, reservation, and cursor attachment are persistence and Session concerns. The Agent loop only needs the uniform `SessionPreparation` ownership boundary.

**Turn `readFrom()` into logical preparation.** Rejected because watermark consumers need a detached physical suffix and, on seek-capable backends, a bounded read. Recovery balancing and whole-Session reuse have different semantics.

## Consequences

One cold materialization can serve history pagination, subagent descriptor inspection, and a later resume. Ownership transfer removes redundant restoration clones, while the bounded per-coordinator LRU limits memory and avoids creating live Agents for queries. Create and resume share one publication protocol without merging Agent and Session responsibilities.

The first cold inspection now pays the complete validation and Session-construction cost and may retain that unpublished Session until eviction. Persistence must coordinate reservation, append, repair, and publication, and callers must treat inspection values as immutable borrowed state. Backends that rely on the default `prepare()` remain correct but do not receive the reuse optimization.
