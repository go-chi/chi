# Agent Note: Exact session query service

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-10-session-query-service.zh.md)

## Problem

Session history exists in two places: current `SessionStore` objects and an optional persistence backend. Consumers that need exact inspection would otherwise duplicate live-versus-persisted precedence, persistence lifecycle handling, raw-event surface classification, relationship tracing, and defensive cloning. Durable state can lag the live log between checkpoints, so persistence alone is not a truthful current source.

Full-text search is related but materially larger. Putting provider coordination, synchronization, invalidation, ranking, and cursor state into the exact-read service would create a second state machine beside the concrete database owner.

## Decision

`@deepseek-ai/dsh-session-query` owns the single abstract `ctx.sessionQuery` service over one logical corpus. It concretely implements `listSessions()`, provider-independent `filterSessions(filters)`, `listEvents(sessionId)`, `filterEvents(sessionId, filters)`, bounded `readEvent(request)`, `traceSession(sessionId)`, and `traceEvent(request)`, while concrete backends implement its two full-text methods. The [unified service decision](../../archived/architecture/2026-07-23-unified-session-query-service.md) owns that topology, the [SQLite search decision](2026-07-10-sqlite-session-query-provider.md) owns search behavior, and the [tracing decision](2026-07-13-session-query-tracing.md) owns lineage and event-relationship semantics.

The service observes the optional `ctx.sessionPersistence` binding dynamically but retains no persisted cache or invalidation listener. Each cross-corpus list asks the active backend for authoritative metadata, then overlays a fresh live-store list. Matching ids become one `SessionRecord`: the live header wins and `live`/`persisted` independently report source availability. Immutable header disagreement is `SESSION_QUERY_SOURCE_CONFLICT`.

An exact target read first checks the live store and snapshots the live header and event log. This path never consults persistence, so a failing durable backend cannot make known live history unreadable. With no live target, the service lists current persistence metadata, proves the id exists, loads it, and rejects a list/load header mismatch. All returned headers and events cross one structured-clone boundary.

## Surface semantics

`dsh-session` exports `foldSurface(events)`, and `SurfaceManager` uses the same transition functions for its incremental cache. The fold returns detached current event sequences and each replacement's actual removed seqs. `listEvents()` and `traceEvent()` use that result to classify every raw event, so inspection cannot disagree with model-history derivation about positional replacement semantics.

`readEvent()` returns the complete target plus raw neighbors by contiguous seq. `before` and `after` default to zero and are independently bounded by `readWindowMax`, default 50. The result carries a cloned `SessionHeader`, not a source-availability record, because determining a live target's persisted flag would violate the guarantee that live exact reads do not depend on persistence health.

## Security boundary

The service is context-wide trusted infrastructure, not an authorization layer. A future model-facing history tool or human UI applies explicit caller/session scope. The service adds no model-facing tool and changes no transcript or snapshot surface.

## Alternatives considered

- **Put logical-corpus resolution directly in every consumer** — rejected because source precedence, conflicts, optional-service lifecycle, cloning, and surface classification are shared correctness rules.
- **Query only persistence** — rejected because checkpoints can lag the current live log.
- **Cache persisted metadata and listen for writes/removals** — rejected because exact reads can ask the authoritative sources directly, while cache invalidation adds lifecycle and concurrency state before scale requires it.
- **Put provider registration into the exact-read service** — rejected because the SQLite package owns one reconciliation/transaction lifecycle; a registry would split that state without a second provider to justify it.

## Consequences

The inherited exact-read implementation has one source-resolution state variable: the currently mounted persistence service. It has no provider queues, fingerprints, extractor registries, observation generations, or derived index updates; a concrete backend owns its full-text state separately. Exact reads, semantic scans, and event traces remain usable in live-only deployments and deterministic when persistence is present.

Cross-corpus listing, lineage tracing, and persisted event operations perform backend I/O on each call. That is deliberate: correctness comes from current authoritative state, while scale-oriented full-text methods use the concrete backend's SQLite derived index.
