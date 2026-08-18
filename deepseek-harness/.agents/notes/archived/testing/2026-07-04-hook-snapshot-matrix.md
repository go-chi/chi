# Agent Note: Hook snapshot matrix — end-to-end expected outputs for both bridges

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-04-hook-snapshot-matrix.zh.md)

## Problem

The hook bridges — [`dsh-hooks-claude`](../../../../packages/hooks/hooks-claude) (7 Claude Code hook points) and [`dsh-hooks-codex`](../../../../packages/hooks/hooks-codex) (5 Codex points) — map external hook commands onto the harness interception seams. They carry deep unit and coverage-spec coverage (every decision arm, every payload dialect, driven against a mocked seam) plus one key-gated e2e (`hooks.e2e.ts`, a live `PreToolUse` block). But the full-transcript snapshot tier — the one net that boots the real `acp-agent` subprocess, replays a recorded session keyless, and diffs the normalized ACP stdout + re-persisted log against committed expected outputs — covered exactly ONE hook: a Claude `UserPromptSubmit` block (`hook-cc-promptsubmit-block`).

That is the tier a mocked unit test structurally cannot be: it exercises the REAL bridge translating a REAL hook process's outcome into the REAL seam decision, then the REAL loop's reaction through the automation wire and persisted log. A bridge-translation or loop-structure regression that left every unit green would still escape it for every hook point but one — and for the Codex bridge, the ACP example did not even LOAD it, so no Codex hook could fire end-to-end at all.

## Decision

The implementation has two coupled parts:

### 1. The ACP example ships BOTH hook bridges

`examples/acp-agent/cordis.yml` and `cordis.snapshot.yml` now load `dsh-hooks-codex` alongside `dsh-hooks-claude`, each pointed at its own config file (`./hooks.json` for Claude, `./codex-hooks.json` for Codex — the two dialects cannot share one file). This is a genuine product-surface change, not test-only wiring: the shipped ACP server (and the `demo:acp` front door) now carries both bridges.

It is safe because a bridge whose config file is absent is a **silent no-op**: `apply()` catches the read failure, logs through `ctx.logger`, and registers nothing — zero listeners, zero session events. The `acp-agent` app ships no stdout logger, so the warning cannot reach the ACP JSON-RPC channel. A scenario (or a real project) that wants only Claude hooks ships only `hooks.json`; the Codex bridge sees no `codex-hooks.json` and vanishes. This was verified empirically: with both bridges loaded, all pre-existing snapshots (none of which ship a `codex-hooks.json`) are byte-identical.

Loading both is the minimum that lets the snapshot tier exercise each dialect against the same real app the product ships. Recording (which boots `cordis.yml`) loads both by construction, and replay inherits them the same way: `cordis.snapshot.yml` is an include-overlay of `cordis.yml` that swaps only the llm entry (see [single-source the acp-agent replay config](2026-07-04-single-source-acp-replay-config.md)), so a bridge added to the live tree is in the replay tree with no second edit.

### 2. A snapshot scenario per hook point × its headline outcome, both dialects

Thirteen scenarios under `examples/acp-agent/tests/snapshots/`, naming `hook-<dialect>-<point>-<outcome>`:

- **Authored, no model turn** (keyless, no sidecar — the derived replay script is empty; the `rejected` turn carrying `hook/*` events is compared): `hook-cc-promptsubmit-block`, `hook-codex-promptsubmit-block`.
- **Recorded against the real API, hook active during recording** (the model's reaction to the decision is part of the captured transcript, replayed keyless thereafter): `hook-{cc,codex}-promptsubmit-context` (allow + additionalContext fold), `hook-cc-pretool-deny` / `hook-codex-pretool-block` (deny → `isError` tool result), `hook-cc-pretool-ask` (ask → degrades to deny with the approval-required reason), `hook-{cc,codex}-posttool-block` (block with feedback), `hook-{cc,codex}-posttool-context` (accept + additionalContext), `hook-{cc,codex}-stop-continue` (a blocking Stop hook forces one extra step via steering).

Each hook command emits only FIXED LITERAL strings (no timestamps/pids/`$RANDOM`/cwd echoes); the snapshot normalizer scrubs the one volatile field a `hook/result` carries (`durationMs`). The `Stop` scenarios self-limit with a marker file (`.stop_fired`) so the force-continue does not loop — the `stop_hook_active` loop-guard is still a bridge `TODO`, so an unconditional Stop hook would force-continue every step.

The `PostToolUse` block scenarios self-limit at the mechanism they prove. The Claude hook persists a workspace marker after its first rejection, so one recovery call is allowed; the Codex prompt makes one call and reports the injected result. Each expected output pins one blocked call without repeated block/retry cycles.

### Three hook points are deliberately NOT snapshotted

Discovered while building the matrix, and documented here because the omission is a decision, not an oversight:

- **`SessionStart` and `SubagentStart`** inject context through a detached, best-effort `void runPoint(...).then(agent.inject())` with NO turn binding. The resulting `context/message` races the work it precedes (the first model request / the child's first turn) and lands at a nondeterministic log position. A recorded expected output does not even reproduce on its own replay — a 10× replay stability check failed 10/10 for both. They stay on the bridges' unit coverage, which drives the seam directly without the timing race. (If the injection is ever made turn-bound and deterministic — the direction the `TODO(session-start-gating)` points — these become snapshottable.)
- **`SubagentStop`** is observe-only: its `subagent/end` handler passes no turn (so no `hook/*` log events) and does no injection. It writes NOTHING to the transcript, so an expected output would be byte-identical to the no-hook run and could never be proven to fail — a guard that cannot bite. It stays on unit coverage (`bridge.spec.ts` already asserts the observe-only call).

The matrix therefore covers every hook point that has a DETERMINISTIC, OBSERVABLE transcript footprint, for both dialects.

## Consequences

- Every bridge seam mapping with an observable transcript is now guarded at the full-transcript tier, in the real app, for both dialects — including the Codex bridge, which had no end-to-end coverage at all. Recorded expected outputs capture the model's real reaction to a denied/blocked/force-continued turn, which a hand-authored transcript could only guess at.
- The `UserPromptSubmit` block scenarios are authored keylessly (no model turn); the rest replay keylessly from recorded fixtures. `pnpm run test:snapshot:record` regenerates the recorded fixtures from the live API and self-skips without a key like every recorded scenario.
- The prove-red discipline holds: tampering a hook config's output (e.g. changing a deny reason) turns its scenario red on replay — the hook process runs FOR REAL during replay (only the model is replayed), so the expected output guards the actual hook→seam→loop path, not a mock of it.
- The `acp-agent` demo now loads a Codex bridge it will usually no-op (no `codex-hooks.json` in a typical project), which is the intended fail-soft behavior, not a cost.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
