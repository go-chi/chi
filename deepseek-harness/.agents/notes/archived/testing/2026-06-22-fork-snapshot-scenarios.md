# Agent Note: Record fork and mixed spawn+fork snapshot scenarios

Status: implemented
Archived: 2026-07-26

English | [中文](2026-06-22-fork-snapshot-scenarios.zh.md)

## Problem

The [seed-boundary Agent Note](2026-06-22-fork-child-replay-seed-boundary.md) made fork-child replay route correctly: `dsh-llm-replay` derives a child's script from the events at or after its persisted `seedLength` boundary, so a fork child's inherited parent prefix is not replayed as the child's own model calls. But it shipped with **no recorded fork scenario** — the slice was exercised only by `llm-replay`'s unit tests (a synthetic child fixture) and a persistence round-trip test. The full-transcript snapshot tier, the one net that boots the real `acp-agent` and replays an end-to-end nested transcript, had only spawn children (`subagent-spawn`, `subagent-multi`). A fork-routing regression that left the unit tests green would still have escaped the tier built to catch transcript regressions.

The snapshot infrastructure to express a fork scenario was already in place — both in-process backends are wired into `cordis.yml` / `cordis.snapshot.yml` as two model-facing tools (`subagent` → spawn, `subagent_fork` → fork), the harness harvests every child log, and replay forwards per-child fixtures keyed by `seedLength`. What was missing was a *recorded scenario* that drives a fork child through it.

## Decision

Record two scenarios against the real API, both replayed keyless in the default gate:

- **`subagent-fork`** — the parent completes a turn that establishes a fact, then delegates one subtask via `subagent_fork`. The fork child inherits the conversation (its log carries a non-zero `seedLength`), so it can answer from the parent's context. This is the focused regression: the child fixture's `seedLength` is the boundary the replay slice depends on, recorded from a real fork rather than hand-synthesized.
- **`subagent-mixed`** — the parent completes a turn, then delegates once via `subagent` (a fresh spawn child, `seedLength` 0) and once via `subagent_fork` (a fork child, non-zero `seedLength`) in one transcript. This is the mixed spawn+fork scenario the seed-boundary and per-session-replay Agent Notes both named as a future addition: one transcript exercises both transports and both branches of the slice (`seedLength` 0 = no-op, `seedLength > 0` = trim the inherited prefix), with the two children ordered spawn-then-fork by `createdAt`.

### Why a completed turn-1 is required

The fork backend seeds the child with the parent's **balanced completed-turn prefix**. A parent that forks on its very first turn has no completed turn to inherit, so the seed is empty (≡ a fresh spawn, `seedLength` 0) — which would NOT exercise the slice. Both scenarios therefore use a two-prompt input: the first prompt completes a turn (establishing a codeword the child is later asked to recall), the second delegates the fork. The recalled codeword in the child's transcript is incidental to the model's behavior; the load-bearing artifact is the child fixture's recorded `seedLength`, which the replay slice consumes.

## Consequences

- The fork-routing slice is now guarded at the full-transcript tier, not just by unit tests. Removing the `slice(seedLength)` (replaying the whole child log) turns **both** new scenarios red — the fork child receives the parent's recorded chunks instead of its own — proving the guard bites (verified red→green when the scenarios landed).
- `subagent-mixed` is the first snapshot scenario to drive two *different* subagent backends in one transcript, exercising the per-session replay keying across a spawn and a fork child simultaneously.
- Out-of-process (ACP) subagent replay remains a different shape (each child is its own process with its own replay) and is still tracked as `TODO(acp-subagent-replay)` — these scenarios are in-process only.
- Re-recording (`pnpm run test:snapshot:record`) regenerates all four fork/spawn fixtures from the live API; the two new scenarios self-skip without a key like every recorded scenario.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
