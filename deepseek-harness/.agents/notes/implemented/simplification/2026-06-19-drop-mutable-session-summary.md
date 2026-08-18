# Agent Note: Drop the mutable session summary

Status: implemented

English | [中文](2026-06-19-drop-mutable-session-summary.zh.md)

## Problem

The [session-persistence seam](../architecture/2026-06-14-session-persistence.md) split a session's out-of-log metadata into two types owned by `dsh-session`: an immutable `SessionHeader` (`version`, `id`, `createdAt`, `cwd?`, `parentSession?`) written once at creation, and a mutable `SessionSummary` (`updatedAt`, `title?`, `firstPrompt?`) "updateable without touching the append-only log". Their union was `SessionMeta = SessionHeader & SessionSummary`, and the abstract `SessionPersistence` service carried a seventh method — `update(id, summary)` — for rewriting the summary. Each backend implemented the mutable store its own way: JSONL wrote a separate atomic `.summary.json` **sidecar** beside the log (temp-write + rename, best-effort), SQLite kept `updated_at`/`title`/`first_prompt` **columns** bumped inside the append transaction.

The summary was designed for a future session picker (recency ordering via `updatedAt`, a `title`/`firstPrompt` preview). That picker was never built. An audit of the whole repo found the entire `SessionSummary` API is **dead state**:

- `SessionPersistence.update()` has **zero production callers** (every `.update(` hit is `createHash().update()` or a test).
- `firstPrompt` is **never read** anywhere in production.
- Session titles come from durable `session/title` events, while tool-card titles come from tool presenters; neither reads mutable session metadata.
- Persistence-list consumers use immutable header identity, creation, lineage, and cwd fields. Recency and previews derive from the log rather than an `updatedAt` summary.
- Decisively: the live `Session.header` was already typed `SessionHeader`, not `SessionMeta` — the summary never existed on the live session object; it lived only in the persistence layer, written and read by nothing but its own contract test.

## Decision

Delete the mutable session summary entirely. `SessionSummary` and the `SessionMeta` name are removed; the metadata a backend stores and returns is just `SessionHeader`. `SessionPersistence.update()` is removed from the abstract service and every backend. JSONL loses the whole sidecar machinery (`writeSidecar`/`readSidecar`/`touchSummary`/`removeSidecars`/`sidecarPath` and the load/list overlays); SQLite drops the `updated_at`/`title`/`first_prompt` columns and the per-append `updated_at` bump, and its `SCHEMA_VERSION` goes `1 → 2`.

Anything the summary was meant to provide is **derivable from the append-only log** when a consumer actually needs it (`firstPrompt` = first `user/message`; recency = the last event's `time` or the file mtime) or already lives in the immutable header (`createdAt`, `cwd`). The one thing *not* derivable — a user-*edited* title — had no implementation and is pure YAGNI; it can return as its own log event or header field if a real feature ever needs it.

The removal narrows a public service contract and an on-disk format across two backends; the summary was a deliberate forward-looking design, not an accident; and `SessionHeader` now stands where the original Agent Note described `SessionMeta`, which is why the summary vanished. It also unblocks the [shared persistence write coordinator](../architecture/2026-06-18-shared-persistence-write-coordinator.md): with no mutable summary, the coordinator's hook interface needs no `updateSummary` hook and the JSONL-sidecar-vs-SQLite-column durability divergence disappears, so the two backends' write paths converge.

## No migration

This is unreleased software (see [root AGENTS.md](../../../../AGENTS.md) § "Pre-release stance: foundation over blast radius"), so there are no on-disk databases or logs to preserve. SQLite does not migrate a v1 database: the `openDatabase` guard now rejects any non-current on-disk `user_version` (`onDisk !== 0 && onDisk !== SCHEMA_VERSION`) — older *or* newer — so a stale v1 DB is cleanly rejected rather than half-read against the new column set. A fresh database stamps the current version; that is the only path that needs to work.

## Consequences

A future session picker now has to derive its preview/ordering from the log (or reintroduce a typed field) rather than reading a ready-made summary row. That is the correct cost: a cache for a feature that does not exist is dead weight that every backend pays to maintain and every contract test pays to assert. The principle — **a passing test pins current behavior, not necessarily correct behavior; behavior can be an artifact of a past compromise** — is now recorded as a standalone convention in [root AGENTS.md](../../../../AGENTS.md), with this change as its worked example.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
