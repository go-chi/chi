# Agent Note: Drop durable step boundary events

Status: rejected — `step/end` is the durable indication that a model step finished, and keeping the symmetric `step/start` / `step/end` pair makes crash repair, invariants, and transcript inspection clearer than inferring completion from adjacent step-scoped events.

English | [中文](2026-06-20-drop-durable-step-boundaries.zh.md)

## Problem

The session log stores `step/start` and `step/end` events even though every step-scoped event already carries `{ turn, step }`: assistant chunks, assistant messages, tool calls, tool results, usage, and errors. `deriveMessages()` ignores step boundaries, ACP ignores them for UI, and the main consumers are invariants, tests, snapshot expected outputs, and crash repair.

The rejected argument was that boundary events make the log more ceremonial than informative. In practice, `step/end` is concrete information: a reader can tell whether a model request finished, crashed, or is being repaired without deriving that state from the next event. A bare `step/start` is likewise useful for a model request that began but produced no chunks before failing.

## Proposal

Make the turn the only durable boundary. Remove `step/start` and `step/end` from `SessionEventMap`; keep the numeric `step` field on events that need grouping. The loop increments the step counter and records step-scoped events with that number, but it no longer appends open/close boundary events. Consumers infer step groups from contiguous events sharing `(turn, step)`.

The invariants plugin should enforce that step-scoped events have valid positive step numbers within an open turn, not that separate boundary records surround them. Crash repair should not synthesize `step/end`; if an interrupted turn is preserved, the repair path can still close the turn without inventing step boundary records.

## Acceptance criteria

- `SessionEventMap` no longer includes `step/start` or `step/end`.
- The loop has no `closeStep()` finalization path.
- ACP snapshots and persistence contract fixtures stop expecting step-boundary lines.
- `deriveMessages()` and replay derive the same message history from step-scoped events.
- The [event taxonomy docs](../../../../docs/architecture.md) describe turns as the durable boundary and steps as a field on step-scoped records.
- The session format version and recorded fixtures are refreshed; non-current stored logs are rejected per the pre-release format policy.

## What we give up

The log no longer records "a model request started but produced no event before the process died" as a durable fact, and no longer has an explicit "this step completed" marker. That loss is not acceptable while the session log is the durable replay and audit surface.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
