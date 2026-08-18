# Agent Note: Bounded session persistence write batching

Status: implemented

English | [中文](2026-08-08-bounded-session-persistence-write-batching.zh.md)

## Problem

Streaming responses can emit many `assistant/chunk` events in a short interval. The persistence coordinator previously scheduled a backend append as soon as an idle queue received one event. Events arriving while that append was active shared a follow-up batch, but a fast backend could still produce many small durable appends. Each JSONL append creates and syncs a Zstandard frame or raw suffix, while each SQLite append opens and commits a transaction and increments the session revision.

Dropping chunk events or replacing them with assembled messages would reduce logical storage, but it would also change the event log, replay, sequence numbers, timestamps, and the chunk seqs cited by assistant messages. The write-amplification problem does not require that larger semantic change.

### Quantified baseline

Repository fixtures make the logical volume concrete. Decoding the current packed rows in [`goal-multi-turn-actions`](../../../../apps/web/tests/snapshots/goal-multi-turn-actions/session.jsonl) yields 2,098 events: 2,017 chunks (96.1%). Their unpacked JSONL lines occupy 332,647 of 379,225 event bytes (87.7%), while chunk packing reduces the committed file to 89,176 bytes and 182 storage rows, including 23 packed chunk rows. [`permission-policy-context`](../../../../apps/web/tests/snapshots/permission-policy-context/session.jsonl) yields 813 events: 746 chunks (91.8%) and 118,935 of 184,821 unpacked event bytes (64.4%); its packed file is 84,917 bytes and 123 storage rows, including 14 packed rows. These are tracked deterministic fixtures, not a production workload distribution, but they demonstrate why deleting chunks would reduce logical volume and why the existing packed-row layout already removes much of their JSON envelope cost.

SQLite stores one row per logical event, so those same logical logs would retain 2,098 and 813 event rows respectively; batching does not change those counts. JSONL writes one Zstandard frame and fsync per durable append batch, while SQLite performs one transaction and one session-revision increment per batch. Runtime files do not record former append boundaries, so fixture row counts cannot honestly be presented as fsync or transaction counts.

The scheduling bound is deterministic. With an immediately resolving sink, the former immediate controller could issue one append for each event arriving after the previous append completed. A controller test admits 20 events 10 ms apart: the 200 ms fixed window hands all 20 to one append. This is a 20-to-1 reduction for that cadence, not a universal ratio. Sparse events, mandatory flushes, slow prior writes, and different arrival rates produce different batch sizes.

## Decision

The first-party JSONL and SQLite plugins expose `writeBatchMaxDelayMs`, a positive integer no greater than Node's timer limit. Its default is `200`. Each plugin resolves the value at load and passes it to `PersistenceCoordinator`; the coordinator remains the single owner of batching behavior.

Each live Session receives a package-private `SessionWriteBehind`. When its pending queue changes from empty to non-empty, the controller starts one fixed window. Later events join that batch without resetting the deadline: this is bounded coalescing, not debounce. When the deadline expires, the controller hands the complete pending prefix to the existing per-id serialization and `appendBatch` path. At most one write for a Session is active. Events admitted during that write form a new pending prefix with their own fixed deadline; if that deadline expires before the active write completes, the new prefix starts immediately after it.

`writeBatchMaxDelayMs` bounds only the controller's intentional batching wait. Event-loop scheduling, initialization, an earlier serialized operation, and backend I/O can delay durable completion, so the option is not a hard fsync or crash-loss SLA.

`session/flush` cancels any remaining wait and becomes a shared quiescence barrier. It drains the active attempt and every event admitted while the barrier is running before it resolves. Session retirement and backend disposal use that same barrier, so lifecycle teardown never waits for the batching timer. The checkpoint policy continues to place mandatory barriers before model requests and top-level tool side effects.

Every event remains durable in its original order and shape. The controller copies each event on admission; no `assistant/chunk`, `seq`, `time`, surface metadata, or storage record is removed or rewritten. JSONL can therefore encode more events in one append frame, and SQLite can insert more event rows in one transaction, without changing either on-disk format or schema version.

A failed background append restores its complete batch before any newer pending events, reports the failure once, and pauses automatic retry. The next newly admitted event opens a fresh fixed window; an explicit flush, retirement, or disposal retries immediately and surfaces a repeated failure to its caller. This avoids a timer-driven failure loop while preserving the existing recoverable flush boundary.

This decision supersedes only the immediate scheduling cadence in [Collapse live persistence into one flush controller](../simplification/2026-07-23-collapse-persistence-flush-state.md). That note remains authoritative for one controller per live Session, retained failed batches, per-id serialization, retirement, and quiescent disposal. The [shared persistence coordinator](2026-06-18-shared-persistence-write-coordinator.md) remains the owner of the backend hook boundary.

## Alternatives considered

**Do not persist streaming chunk events.** Rejected here: it changes the event-sourced authority and recovery semantics rather than only physical write cadence. The existing [assembled-message rejection](../../rejected/simplification/2026-06-20-assembled-assistant-messages-only.md) remains the guardrail until a no-information-loss replacement defines replay, fork, cited source-event links, sequence, and crash behavior independently. The [packed-row decision](2026-07-26-packed-chunk-rows-by-default.md) remains the complementary JSONL storage-size optimization.

**Write only at semantic checkpoints.** Rejected: it maximizes batching but makes the ordinary crash-loss window depend on a separately mounted policy. Bounded background writes preserve progress between checkpoints while mandatory flushes keep their stronger ordering contract.

**Debounce from the latest event.** Rejected: a continuously streaming response could postpone its first write indefinitely. A fixed window from the first pending event provides a real upper bound on intentional coalescing wait.

**Implement timers separately in JSONL and SQLite.** Rejected: scheduling, failure retention, flush races, and teardown are backend-neutral lifecycle concerns. Duplicating them would reopen the drift that `PersistenceCoordinator` removed.

## Verification

The controller tests use a fake clock to prove the fixed, non-resetting 200 ms window; immediate and shared flush barriers; events admitted during a barrier; an over-budget tail behind an active write; ordered failure retention; paused automatic retry; and explicit retry of an overlapping background failure. Coordinator tests run the controller through Session notifications, retirement, collision reclamation, and teardown. The JSONL and SQLite suites retain their storage-format, transaction, recovery, and shared persistence-contract coverage.

## Consequences

High-frequency event bursts normally produce fewer durable append operations while preserving the exact logical event count. The reduction depends on arrival rate and backend latency: a burst inside one 200 ms window becomes one batch, while mandatory flushes and sparse events can still produce small batches.

This decision does not cap pending event count or bytes behind a slow backend, and it does not reduce SQLite rows or the decoded logical log. A demonstrated memory bound or logical-retention policy would require its own failure and replay contract rather than another hidden timer rule.

An admitted event can remain only in memory during the configured window, and then while scheduling or backend work is outstanding. Deployments choose a smaller value for a narrower ordinary loss window or a larger value for stronger batching. Explicit durability boundaries remain unchanged and bypass the wait.

The new deep module gives the timer, active write, pending prefix, retry pause, and barrier one owner. `PersistenceCoordinator` retains initialization and identity serialization; backends retain only durable storage primitives. Neither `SESSION_FORMAT_VERSION` nor SQLite `SCHEMA_VERSION` changes.
