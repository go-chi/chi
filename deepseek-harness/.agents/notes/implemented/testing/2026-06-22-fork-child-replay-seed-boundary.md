# Agent Note: Persist the seed boundary so fork-child replay routes correctly

Status: implemented

English | [中文](2026-06-22-fork-child-replay-seed-boundary.zh.md)

## Problem

The [per-session snapshot replay Agent Note](2026-06-22-subagent-snapshot-replay.md) made the snapshot tier express a nested-agent shape: a parent plus one recorded log per in-process subagent, each replayed as its own script keyed by calling session. It noted (§ Scope, final bullet) that a fork snapshot was "a trivial future addition, not a gap in the keying." That was wrong about a fork child specifically — not the keying, but the *script derivation*.

A subagent script is derived from a recorded session log by [`deriveReplayScript`](../../../../packages/test-support/llm-replay): it groups the log's `assistant/chunk` events by `(turn, step)` into one replay entry per `stream()` call. This is correct for a **spawn** child, whose log contains only its own model calls.

A **fork** child is different. The fork backend seeds the child session with a *balanced completed-turn prefix of the parent's log* ([`dsh-subagent-in-process-driver`](../../../../packages/subagent/subagent-in-process-driver)), and that seed becomes the child session's persisted `log` (`Session`'s constructor copies the seed into `this.log`). So a fork child's `.jsonl` begins with the **parent's** events — including the parent's `assistant/chunk` events — and only then carries the child's own turn.

Deriving the child script from the whole fork-child log therefore replays the **parent's** recorded responses as the **child's** model calls: the live fork child's first `stream()` would receive the parent's first recorded chunk sequence instead of its own. The recorded scenarios are all spawn today, so this never fired — but a fork snapshot would have mis-routed silently, exactly the class of bug the snapshot tier exists to catch.

## Decision

Record where a session's **inherited** prefix ends, persist it, and have the replay harness derive a child's script from its **own** events only.

### 1. `seedLength` on the session header

`SessionHeader` gains an optional `seedLength: number` — how many leading events were inherited via a seed rather than produced by this session. The fork backend stamps it (= the seeded-prefix length) when it creates the child; a fresh spawn leaves it absent (≡ 0). It is threaded through `CreateSessionOptions.meta` (and `CreateAgentOptions.meta`), set in `SessionStore.prepare`.

`seedLength` is **explicit**, never inferred from `seed.length`. A reconstruction (resume/load) seeds the session with its WHOLE stored log, so `seed.length` there is the full length, not the original boundary — the resume path passes the persisted `seedLength` back from the loaded header instead. (Same shape as `createdAt`, which is also explicitly preserved on reconstruction rather than re-defaulted to now.)

### 2. Both persistence backends round-trip it

- **JSONL**: a `seedLength` field on the header line (`toHeaderLine`/`fromHeaderLine`).
- **SQLite**: a `seed_length` column on the `sessions` table.

The SQLite layout containing `seed_length`, `source_event_seqs`, and `surface_op` is schema version 4. Earlier version 3 layouts were ambiguous, so every non-current `user_version` is rejected without migration under the pre-release policy.

### 3. Replay derives a child script after the boundary

`dsh-llm-replay`'s `parseSessionHeader` now also reads `seedLength` (absent ⇒ 0), and `loadSessionScripts` derives a child's entries from `parseSessionLog(text).slice(seedLength)` — the events at or after the boundary, i.e. the child's own model calls. For a spawn child `seedLength` is 0 and this is a no-op, so spawn scenarios are byte-for-byte unchanged.

This closes the routing correctness gap, and two recorded fork scenarios exercise it end to end — see [Record fork and mixed spawn+fork snapshot scenarios](../../archived/testing/2026-06-22-fork-snapshot-scenarios.md).

## Alternatives considered

- **Derive the boundary heuristically in `llm-replay`** (the seeded prefix is contiguous parent events ending at the last `turn/end` before the child's first `user/message`). Rejected: a brittle heuristic in the test harness that re-derives a fact the producer already knows. Persisting the boundary at its source (the fork backend) is the "explicit > implicit at package boundaries" rule applied across the persistence boundary — the reader of a child fixture never has to reconstruct where the inheritance ended.
- **Pin the format version instead of bumping** (the `SESSION_FORMAT_VERSION = 0` "unstable" stance the event log uses). Rejected for the SQLite *table* layout: `SCHEMA_VERSION` is the monotonic bump-and-reject knob (a small enumerable set of revisions worth telling apart), distinct from the event-vocabulary `version`. Adding a column is precisely the breaking table change it versions, so it bumps.

## Consequences

- A new persisted header field across core + both backends; the subsystems catalog (`persistence.md`) is updated in the same change (its `SessionHeader` / `CreateSessionOptions` `type-equiv` blocks).
- Existing SQLite databases at schema v2 are rejected on open (no user data pre-release).
- Spawn replay is unchanged (`seedLength` 0). Fork replay now routes a child to its own script; covered by a regression in `llm-replay`'s tests (a child fixture whose seeded prefix carries a parent chunk — the derived child script must exclude it, proven red without the slice) and a persistence round-trip test (both backends, via the shared coordinator contract).
