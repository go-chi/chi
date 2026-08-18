# Agent Note: Shared persistence write coordinator

Status: implemented

English | [中文](2026-06-18-shared-persistence-write-coordinator.zh.md)

## Problem

`dsh-session-persistence-jsonl` and `dsh-session-persistence-sqlite` intentionally prove the same `SessionPersistence` contract over different storage media, but their write-path orchestration was duplicated: per-session state, `session/created` adoption, backend-specific prefix reads, write-behind control, per-id operation serialization, HMR seeding, and dispose drains. The pure seed-prefix collision and serializability guards had already moved into the Service Definition package; the remaining orchestration was still correctness-heavy and received the same fixes twice. Only the storage primitives (write bytes vs. INSERT rows) differed.

## Decision

Extract a backend-agnostic `PersistenceCoordinator` into `dsh-session-persistence`. The coordinator owns the orchestration once; each first-party backend composes one (`new PersistenceCoordinator(ctx, this)`), implements a small `PersistenceBackend` hook interface, and delegates its stateful public methods (`create`/`append`/`prepare`/`load`/`inspect`/`readFrom`) to it. Backend-owned metadata and revision listing bypass the coordinator.

Composition, not inheritance. The coordinator is a concrete class the backend holds, not a base class the backend extends. The risk that a coordinator makes unusual backends fight an inheritance hierarchy is avoided: a backend exposes only the hooks and cannot reach the coordinator's private orchestration state. A third-party backend MAY still implement the abstract service directly without the coordinator, including immutable logical inspection and the default preparation fallback through `load`.

The coordinator holds one lifecycle entry for each exact live `Session`: initialization plus a package-private write controller that owns pending events, a fixed batching deadline, the active write, failure retention, and the shared flush barrier. Each `session/event` enters that bounded write path, and `session/flush` bypasses the wait to observe quiescence. The [flush-controller simplification](../simplification/2026-07-23-collapse-persistence-flush-state.md) owns controller consolidation; the [bounded batching decision](2026-08-08-bounded-session-persistence-write-batching.md) owns scheduling cadence.

The coordinator retires a session from `session/disposed`: it waits for the controller's initialization and current flush, serializes a final drain, and removes the controller and owned per-id state only after success. A failure leaves the controller discoverable for backend teardown to retry. Settled per-id chain tails remove themselves only when they are still current, so a completion cannot erase a newer operation for the same id. Backend teardown unregisters write-path listeners, flushes every remaining controller, awaits per-id operations, and then closes the backend.

### The hook interface (`PersistenceBackend<TornMarker>`)

Five required members plus an optional lifecycle hook form the only boundary between the coordinator and storage:

- `name` — backend label for the dispose-failure `AggregateError`.
- `loadStored(id)` — read one stored prefix by id across every storage scope (every JSONL project directory; SQLite's id is globally unique). Preparation, logical load/inspection, physical suffix reads, live adoption, and the create-collision probe share this lookup. The coordinator asserts the returned id and rejects a stored/live cwd mismatch before repair or state publication.
- `appendBatch(meta, events, isMaterialized)` — durably append a contiguous batch, lazily materializing the session ATOMICALLY when not yet materialized (the materialize-write and the first event batch must commit together — a crash between them must not leave a materialized-but-empty session; this is why there is no separate `materialize` hook).
- `commitRepair(meta, tornMarker, closers)` — make a crash repair durable: truncate the torn tail (iff `tornMarker !== undefined`) and append `closers`. **NOT required to be atomic** — JSONL legitimately truncates-then-appends in two fsync'd steps, SQLite does DELETE+INSERT in one transaction. Used by `prepare`/`load` (truncate + synthetic closers) and live-adoption (truncate only, `closers = []`).
- `list()` — list all stored metadata.
- `close?()` — optional lifecycle teardown (SQLite closes its db handle; JSONL omits it), awaited in the dispose effect AFTER the quiescence drain so a close failure never masks a drain error.

### The opaque torn marker

The single design choice that keeps the seam clean: the crash-repair "where is the torn tail" token is OPAQUE to the coordinator. The coordinator computes the synthetic closers (it owns `interruptedTurnClosers` from `dsh-session`), but it only ever tests `tornMarker !== undefined` and passes the value straight back to `commitRepair` — it never inspects it. Each backend picks its own marker type: JSONL carries the byte offset to truncate to plus any complete events decoded from an incomplete final frame, while SQLite carries the seq to delete from. The coordinator therefore knows neither byte lengths nor frame recovery state.

## Testing

The shared `runPersistenceContract` (public-API contract) runs for every backend and proves that `inspect` balances an interrupted logical view without changing storage or revisions before `prepare` or `load` commits recovery. `runCoordinatorContract` (`tests/coordinator-contract.ts`) covers adoption, HMR, collision, session and backend disposal drains, and crash-tail repair through an in-memory reference, JSONL, and SQLite. `persistence.spec.ts`, `preparations.spec.ts`, and `write-behind.spec.ts` cover preparation reuse and reservation, bounded prepared-state eviction, fixed-window follow-up batches, live-controller cleanup, same-id chain-tail races, failed-batch retry, and close ordering. The per-backend specs retain storage mechanics only. A through-coordinator torn-tail repair test per real backend keeps the opaque-marker branch covered because the contract crash case produces synthetic closers without a torn marker.

## Alternatives considered

- **A base class the backends extend** — rejected for composition: a backend exposes only the hooks, cannot reach the coordinator's private orchestration state, and a third-party backend may still implement the abstract service directly without the coordinator at all.
- **A wider hook API** — each candidate hook folds away: there is no scope-specific live lookup because `loadStored` plus the coordinator's cwd check preserves the collision boundary, no storage-locator generic because validated JSONL metadata reproduces its path while SQLite is already id-bound, no separate `materialize` hook because the first batch must commit atomically with materialization, no separate create-collision probe because it is `loadStored(id) !== undefined`, and no coordinator pass-through for `list()` because listing needs none of the orchestration.

## Consequences

The coordinator adds one indirection, an opaque torn marker, detached session-retirement tasks, and bounded prepared Session state, but centralizes correctness-heavy orchestration previously duplicated by every backend. Session disposal remains an observe-only event, so the session owner does not await persistence retirement; the coordinator contains failures, preserves pending events in the live controller, and makes backend teardown the quiescence boundary. Its hook surface stays narrow: identity, adoption, collision checks, preparation, and immutable inspection reuse `loadStored`; materialization stays atomic inside `appendBatch`; and listing bypasses the coordinator. Read models use `inspect` rather than `load`, so observing a persisted open turn does not commit interruption closers; the [Session preparation decision](2026-08-05-session-preparation.md) owns reuse, reservation, and publication. New backends implement storage primitives rather than copy the bounded write lifecycle.
