# @deepseek-ai/dsh-session-query-sqlite

English | [中文](README.zh.md)

Concrete `ctx.sessionQuery` provider. `SqliteSessionQueryEngine` inherits exact reads, traces, and provider-independent filters from the Service Definition package and implements its two full-text methods with SQLite FTS5. Search uses the live-preferred logical session corpus and groups cross-session results by their strongest event.

## Search contract

`searchSessions(request, exec?)` returns `SessionSearchHit` pages across the corpus; `searchEvents(request, exec?)` returns `SessionEventSearchHit` pages within one session. Queries are required, trimmed, whitespace-normalized literal phrases. FTS5 syntax such as quotes, `OR`, `NEAR`, and `*` is treated as data rather than executable MATCH syntax. Metadata filters are parameterized SQL predicates applied before ranking. To keep SQLite FTS5 MATCH in a supported outer-predicate context, cross-session requests may compile at most 14 combined session and event filter predicates; within-session requests may compile at most 13 filter predicates because the fixed target-session predicate consumes one slot. Each range endpoint compiles as one predicate. A request exceeding either predicate budget or SQLite's portable limit of 32,766 total bindings, including fixed query and pagination values, fails with `SESSION_QUERY_INVALID_FILTER` before statement preparation.

Relevance is source-comparable across persistent and TEMP tables: actual FTS5 highlighted-match span count descending, then stored document code-point length ascending. Event time, session id where applicable, and seq break remaining ties. Cross-session results expose the selected event as `bestMatch`; both scopes derive whitespace-normalized plain text from FTS5 highlight positions and bound it in Unicode code points. Cursors are opaque branded values, bind to the normalized request and service instance, and fail when the relevant generation changes. A within-session cursor survives unrelated-session changes; a cross-session cursor does not.

All three surfaces (`current`, `shadowed`, and `log-only`) are searchable by default. Pass a surface filter to narrow them.

## Source and index lifecycle

The service requires `ctx.sessions` and observes optional `ctx.sessionPersistence` dynamically. One serialized state machine compares source-qualified lightweight durable snapshot revisions, non-mutatingly inspects only new or changed logs, extracts shared semantic documents, reconciles changes transactionally, and runs the query. Session queries never invoke the persistence backend's crash-repairing `load()`; an owner attaching during inspection cannot mutate its log, and the stable-observation retry makes the result live-preferred. The TEMP live row still records persisted availability, and the durable base refreshes after that live owner detaches. Repeated queries and an unchanged same-store reopen perform no full durable-log inspection; switching stores, or observing new, changed, deleted, or externally load-repaired sources, reconciles on the next stable observation. Source or transaction failure commits nothing, and the next search retries.

`openAt: startup` is the default: service activation imports `node:sqlite`, opens the handle, and fails before publication when the index is invalid. `openAt: first-search` publishes the service as ACTIVE without importing the SQLite module or opening a handle; the first concurrent searches share one readiness promise, and disposal before any search opens nothing. This mode supports compositions that need clean Node 22 startup output by deferring SQLite's experimental warning until the first actual search; it does not suppress a warning at that point. An invalid database likewise fails the first search instead of service activation. `openAt: never` turns full-text search off for the deployment: `searchSessions` and `searchEvents` fail with `SESSION_QUERY_SEARCH_DISABLED` before any request normalization, node:sqlite is never imported or opened, and no source observation or reconciliation runs, while every inherited exact read, filter, and trace on `ctx.sessionQuery` keeps working.

Persisted FTS rows live in a dedicated derived database. Connection-local TEMP tables hold live rows, which shadow the durable base for the same session and reveal it when the live owner disappears. Unmounting persistence hides durable rows without discarding the cache; remounting reconciles it. Closing or reopening the database drops every live overlay while retaining persisted rows.

The database is disposable but reset is guarded: every recognized schema version rejects unknown user tables before mutating journal mode, and only a recognized incompatible schema containing derived tables rebuilds in place. An unrelated or canonical database is refused. Never point `path` at the session-persistence database. On filesystems with POSIX modes, missing directories and databases are created owner-only (`0700` and `0600` before the process umask), and SQLite sidecars inherit the database mode; existing modes are preserved. Exactly one service in one process owns a derived-index path; external writers or a second process are unsupported because generations and TEMP shadow state are connection-owned.

## Configuration

| Key | Default | Contract |
|---|---:|---|
| `path` | required | Dedicated derived-index SQLite path; `:memory:` is supported. Missing filesystem paths are created owner-only on POSIX filesystems. |
| `openAt` | `startup` | `startup` opens before service activation completes; `first-search` defers the SQLite module and handle until search; `never` disables full-text search (typed `SESSION_QUERY_SEARCH_DISABLED` failures) while inherited reads stay available. |
| `journalMode` | `wal` | `wal`, `delete`, `truncate`, or `persist`. |
| `defaultLimit` | `20` | Page size when a request omits `limit`; at most `Number.MAX_SAFE_INTEGER - 1`. |
| `maxLimit` | `100` | Largest accepted request page size; at most `Number.MAX_SAFE_INTEGER - 1`. |
| `snippetChars` | `240` | Maximum snippet length in Unicode code points. |
| `readWindowMax` | `50` | Maximum `before` or `after` raw-event count for inherited `readEvent()`. |
| `persistedInspectConcurrency` | `4` | Maximum concurrent persisted-log inspections for inherited batch reads; must be a positive safe integer. |

## Tokenizer and limits

The index uses FTS5 `unicode61`. The trade-off is token/phrase recall rather than arbitrary substring recall: `AI` does not match the token `BRAID`. Use `ctx.sessionQuery.filterEvents()` with a `text` clause when a literal whitespace-flexible substring scan is required. NUL is rejected in queries; reserved highlight markers and NUL in documents are normalized before indexing so presentation markers cannot collide with source text.

Abort signals stop queued work and flow unchanged through snapshot listing and non-mutating inspection. Once source work starts, the serialized state machine awaits that backend promise itself—even when a backend ignores cancellation—then checks the signal before starting any further listing, inspection, reconciliation, or query work. The caller therefore observes cancellation only after started backend work is quiescent, and a later search cannot enter the serializer while that cleanup is pending. Node's synchronous `DatabaseSync` API cannot interrupt a metadata or MATCH statement already executing on the JavaScript thread; signals are checked immediately before and after those non-preemptible calls.

## Model Experience

None, as this trusted search backend returns hits only to callers and registers no model-facing prompt, schema, tool, or message.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No caller authorization** — this is a trusted context-wide service; a model tool or UI must enforce its own access policy.
- **Synchronous query execution** — `DatabaseSync` blocks the JavaScript thread during MATCH execution and cannot interrupt a statement already running.
- **Token recall, not arbitrary substrings** — the `unicode61` tokenizer does not match substrings inside a larger token; use `filterEvents()` for literal scans.
- **Single-owner derived index** — one service in one process must own each index path; external writers and multi-process sharing are unsupported.
