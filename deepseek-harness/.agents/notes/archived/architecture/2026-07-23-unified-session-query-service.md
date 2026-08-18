# Agent Note: Unified session query service

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-23-unified-session-query-service.zh.md)

## Problem

Exact reads, semantic filters, relationship traces, and full-text search operate on the same live-preferred session corpus. Exposing full-text search under a second context key makes consumers and app compositions treat one capability as two services, even though the SQLite implementation is the only backend-specific part.

The interface package already owns the shared record, filter, trace, search-request, cursor, and error contracts. A provider registry or coordinator would add runtime selection semantics unsupported by any current consumer.

## Decision

`SessionQueryService` is the single abstract service registered as `ctx.sessionQuery`. It concretely implements listing, title and event reads, surface reads, filtering, and relationship tracing through its backend-independent `SessionCorpus`. Its only abstract methods are `searchSessions()` and `searchEvents()`.

`SessionQuerySqlite` extends that service and is the sole concrete backend. One mounted instance therefore exposes every operation through `ctx.sessionQuery`; its inherited exact operations use the shared corpus implementation, while its SQLite-owned lifecycle observes sources, reconciles the derived FTS index, ranks matches, and owns cursor generations. The interface package has no standalone concrete plugin, search-provider registry, or second context key.

SQLite reconciliation is one quiescent serialized state machine. It passes the caller's exact abort signal into durable snapshot listing and inspection, awaits each started backend operation itself, and checks cancellation after every await and before starting the next source or index operation. Cancellation therefore cannot release the serializer while an ignored or cooperative backend call is still cleaning up, and it cannot start a subsequent listing, inspection, reconciliation, or query after the signal is observed.

Backend configuration includes the inherited `readWindowMax` setting alongside its own index path, journal mode, page limits, and snippet limit. First-party apps that need session queries mount the SQLite backend and place its disposable index beside their configured persistence root.

This service topology supersedes the separate-key portion of the [exact query decision](../feature/2026-07-10-session-query-service.md) and [SQLite search decision](../feature/2026-07-10-sqlite-session-query-provider.md); their corpus, query, tokenizer, reconciliation, and safety decisions remain in force.

## Alternatives considered

- **Keep `ctx.sessionQuery` and `ctx.sessionSearch` separate** — rejected because both expose operations over one logical corpus, force consumers to discover two keys, and let apps accidentally mount only a partial query surface.
- **Keep a concrete base service and let the SQLite plugin register or mutate two search methods** — rejected because method availability would depend on plugin order and teardown, and the service would need a provider registration protocol for one implementation.
- **Move every query implementation into the SQLite package** — rejected because exact reads, filters, and traces require no index and are shared behavior that belongs with their provider-independent contracts.

## Consequences

Consumers inject one service and can combine exact and full-text operations without a second capability lookup. A production composition must choose a concrete backend even when one consumer currently calls only inherited exact methods; tests may use a minimal subclass when backend behavior is outside their scope.

The unified object deliberately retains two internal observation strategies: exact operations read authoritative live/persisted sources per call, while full-text operations reconcile a disposable index. Sharing the context key does not make the derived index authoritative or couple exact-read availability to an FTS query.

Queued cancellation remains prompt. Cancellation during active asynchronous source observation waits for that started operation to settle, which makes rejection a quiescence boundary and preserves single-file execution for a following search. Synchronous SQLite statements remain non-preemptible and are bracketed by signal checks.

Unit coverage pins inherited and abstract behavior on one key, SQLite coverage exercises both operation families on the concrete backend, and the real Loader path verifies that one exported plugin registers the combined service.
