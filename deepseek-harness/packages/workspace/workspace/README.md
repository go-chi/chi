# @deepseek-ai/dsh-workspace

English | [中文](README.zh.md)

Workspace entity registry (`ctx.workspaceRegistry`) for the DeepSeek Harness: durable workspace records, stable workspace order, and a newest-first candidate session index stored through the domain data form. Consumers see the `Workspace` interface; the entity implementation stays package-private.

The entity/storage rationale lives in the [domain Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md); header-only bootstrap and GUI ordering live in the [Workspace UI product-flow Agent Note](../../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md).

## Shape

- `ctx.workspaceRegistry.create(path, title?)` — canonicalizes `path` via `fs.realpath`, rejects a nonexistent or non-directory path, creates at most one record per canonical path, and prepends a new record to durable workspace order. Repeated calls for that path return the existing workspace without changing its title; different paths may share a display title.
- `ctx.workspaceRegistry.get(id)` / `list()` / `resolveByPath(path)` — cache-served lookups. `list()` is synchronous and follows durable registry order; `resolveByPath` is async because it applies the same `realpath` canon and rejects a missing path rather than creating it.
- `ctx.workspaceRegistry.insertBefore(id, before?)` — moves a registered Workspace within durable registry order, DOM-insertBefore-like: before the anchor, or appended when the anchor is omitted. A source or anchor absent from the registry rejects without writing; a self-anchor or move to the current position resolves without writing. The returned id list is the complete committed order.
- `ctx.workspaceRegistry.delete(id)` — removes only the Workspace registration, its durable order entry, and its session account. Unknown ids return `false`; a removed record returns `true`. The directory, user files, live Sessions, and persisted session logs are never touched, so those Sessions become Ungrouped. A table-write failure restores the prior order and published entity.
- `Workspace.attachSession(id)` — validates a live or persisted session header cwd against the workspace path and prepends a new id. Unknown sessions, absent/unresolvable/non-directory cwd values, and mismatches reject without writing. `detachSession` removes only the candidate index entry.
- `Workspace.insertSessionBefore(id, before?)` — moves an accounted session within the manual order, DOM-insertBefore-like: before the anchor, or appended when the anchor is omitted. A session or anchor absent from the account rejects without writing; a move to the current position resolves without writing. Registry Workspace order never changes.
- `ctx.workspaceRegistry.archiveSession(id)` / `archivedSessionIds` — the registry-global archive set, layered over workspace accounting: an archived session disappears from grouping surfaces but keeps its session log and its `sessionIds` slot, so a future unarchive restores its position. Archiving accepts any live or persisted session (accounted or Ungrouped), resolves without writing for an already archived id, and rejects an unknown id. State written before the field existed parses with an empty set.
- `Workspace.sessionIds` — synchronous id-plus-canonical-cwd membership projection in durable candidate order. Missing headers, invalid cwd values, and mismatches are filtered; the next workspace mutation prunes them. A medium indexing one session under two workspaces, claiming one path from two records, or diverging from durable workspace order rejects at startup.
- `Workspace.status()` — uncached directory check, `'ok' | 'missing-dir'`; a missing directory never mutates the record.

`storageDomain` and `sessionPersistence` are required startup dependencies. An unavailable peer leaves the plugin pending and cannot commit an empty initialized marker. On the first successful start, the registry calls `SessionPersistence.list()` and uses only header `id`, `cwd`, and `createdAt` to group valid historical directories and persist initial order; it never reads event bodies. The initialized marker is written last, so partial bootstrap writes are reused safely after restart. Later cwd-only sessions remain Ungrouped.

Create and delete persist an explicit pending-mutation marker before their record and order can diverge. Startup completes only the marked mutation, then clears the marker; an unmarked order/table mismatch remains unexplained corruption and fails loud. Deleting and re-registering the same path creates a fresh Workspace id and does not automatically re-adopt the retained Sessions.

## Model Experience

### Workspace records and session accounts

#### What the model sees

Nothing. `ctx.workspaceRegistry` serves workspace records to host-side consumers only: the package registers no tools, injects no prompts, and writes no session events, so no request field ever carries this package's data.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

- Session deletion and destructive folder removal are separate, absent capabilities; Workspace registration deletion never substitutes for either ([decision](../../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)).
- The header index refreshes at startup and when attach must resolve an uncached persisted id; deletion or cwd damage performed by another process is observed after the next refresh or restart.
