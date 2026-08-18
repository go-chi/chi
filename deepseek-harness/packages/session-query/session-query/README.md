# @deepseek-ai/dsh-session-query

English | [中文](README.zh.md)

`SessionQueryEngine` is the combined abstract `ctx.sessionQuery` contract. It implements exact session-history retrieval, relationship tracing, and provider-independent filtering over live `ctx.sessions` plus optional dynamically mounted `ctx.sessionPersistence`; concrete backends implement its two full-text methods. Matching ids produce one record: live events win, while `live` and `persisted` report both source availabilities. Conflicting immutable headers fail with `SESSION_QUERY_SOURCE_CONFLICT`.

## Reads

- `listSessions(signal?)` reads current persistence metadata, merges live records with live precedence, and returns cloned records in deterministic newest-first order.
- `readSession(sessionId)` returns one complete detached raw log after the same core replay validation used by resume; it never enters the session into the live store.
- `filterSessions(filters, signal?)` applies provider-independent session metadata and availability predicates to that same cloned logical corpus.
- `filterEvents(sessionId, filters)` extracts first-party semantic documents and applies provider-independent metadata and literal-text predicates in ascending seq order.
- `readTitleSnapshots(sessionIds, signal?)` resolves unique ids from one live-preferred corpus observation, passes cancellation through persisted listing and inspection, and returns ordered per-session settlements so one missing or malformed title source does not discard its peers. Each live source is folded directly, and each persisted worker folds to a detached header/title result and releases the full log before dequeuing another id. Cancellation rejects the whole batch. `readTitleSnapshot(sessionId, signal?)` is the one-observation view; `readTitle(sessionId, signal?)` returns only its optional folded `session/title`.
- `listEvents(sessionId)` loads the live-preferred raw log and classifies each event as `current`, `shadowed`, or `log-only` with the shared `dsh-session` surface fold.
- `readSurface(sessionId)` returns one cloned header, raw-log capture boundary, and the complete folded current surface in model-history order. A live session wins over persistence; compaction is observed before or after its replacement append, never as a synthetic mixture.
- `readEvent(request, signal?)` returns a cloned header, the full target event, and a bounded raw-seq window. `before` and `after` default to zero and may not exceed `readWindowMax`.
- `traceSession(sessionId, signal?)` reads the corpus once and returns immediate-to-outward ancestors plus deterministic recursive descendant trees. `complete: false` identifies the first missing parent; a target-connected cycle fails with `SESSION_QUERY_INVALID_LINEAGE`.
- `traceEvent(request, signal?)` loads the logical log once and returns its cloned source header with direct positional replacements and direct cited source-event links. `replacementChain` follows positional replacers to the final replacement; source-event links remain non-transitive.

Persistence is optional and may mount or unmount dynamically. Cross-corpus listing and lineage tracing fail with `SESSION_QUERY_PERSISTENCE_FAILED` while mounted persistence is unreadable; a successfully read durable record that fails Session validation reports `SESSION_QUERY_CORRUPT_SESSION` instead. A title read, event trace, or event read targeting a known live session does not consult persistence, so durable backend health cannot make current in-memory state unreadable. Persisted title and event operations list before loading and reject a metadata mismatch rather than combining inconsistent observations. Lineage-trace cancellation is passed to persisted listing; event-trace and event-read cancellation is passed to persisted listing and inspection. Each waits for the started backend call to settle, then rejects with the signal's exact reason even when the backend ignored that signal. A pre-aborted known-live title read, event trace, or event read rejects before folding or snapshotting without consulting persistence. A batch title observation performs one metadata listing, inspects its unique persisted ids with at most `persistedInspectConcurrency` workers, and preserves each title's own observed header for downstream authorization. Cancellation starts no queued inspections and rejects only after already-started workers settle. `listSessions()` remains lightweight and does not load logs or index titles.

## Filtering and extraction

`SessionResultFilter` covers id, nullable cwd, created-at range, nullable parent, and source availability. `SessionEventResultFilter` covers seq/time ranges, event type, surface, and semantic text. Filter arrays are ANDed; values within one list clause are ORed. Empty list values match nothing, ranges are inclusive, and malformed ranges or closed-union values fail with `SESSION_QUERY_INVALID_FILTER`.

The text clause is deliberately independent of FTS providers: caller text is escaped into a Unicode, case-insensitive regular expression, and each whitespace run matches one or more whitespace characters. It is a literal semantic-text scan, not a full-text query. `extractSessionEventText()` and `buildSessionEventSearchDocuments()` define the shared first-party document projection; reasoning blocks, structural boundaries, stream chunks, request headers, and unknown declaration-merged variants produce no document.

## Full-text methods

`SessionQueryEngine.searchSessions(request, exec?)` groups the logical corpus by strongest matching event; `searchEvents(request, exec?)` searches one logical session. These are the service's only abstract methods. Both return pages whose continuation is an owned branded `SessionSearchCursor`, accept optional cancellation, and expose snippets without provider-specific numeric scores. An event-search page also carries the cloned target header from the same indexed generation as its hits, allowing authorization consumers to bind policy to the payload observation. Search requests accept only metadata event filters, because literal-text filtering is the scan path described above.

The package has no provider coordinator, fallback implementation, or standalone concrete plugin. A concrete service backend inherits the implemented reads, filters, and traces while owning full-text observation, reconciliation, ranking, cursor generations, and query execution; the first implementation is [`@deepseek-ai/dsh-session-query-sqlite`](../session-query-sqlite/README.md).

`SessionQueryError.code` is a closed union covering request validation, missing targets, malformed surfaces, source conflicts, persistence/index failures, cancellation, and invalid or stale cursors; the exact literals are defined in [`src/config.ts`](src/config.ts).

`listEvents()`, `readSurface()`, and `traceEvent()` run the same one-pass `dsh-session` surface fold. A loaded log is valid only when event seqs are zero-based and contiguous, surface markers obey event-type eligibility, source-event arrays are nonempty and duplicate-free, references name earlier events, and each positional replacement names and cites every surface node it removes; every violation fails with `SESSION_QUERY_INVALID_SURFACE`.

## Configuration

| Key | Default | Contract |
|---|---:|---|
| `readWindowMax` | `50` | Maximum `before` or `after` raw-event count. |
| `persistedInspectConcurrency` | `4` | Maximum concurrent persisted-log inspections in one batch read; must be a positive safe integer. |

## Model Experience

None, as this trusted query service returns cloned session records only to its callers and registers no model-facing prompt, schema, tool, or message.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No caller authorization** — this is trusted context-wide infrastructure; a future model tool or UI must constrain which sessions its caller may inspect.
- **No registries or model-facing tool** — extractor and search-provider registries, recursive traversal through cited source events, and a model-facing tool are absent. The [tracing decision](../../../.agents/notes/implemented/feature/2026-07-13-session-query-tracing.md) owns relationship semantics; SQLite ownership and tokenizer decisions live in the [implemented search note](../../../.agents/notes/implemented/feature/2026-07-10-sqlite-session-query-provider.md).
