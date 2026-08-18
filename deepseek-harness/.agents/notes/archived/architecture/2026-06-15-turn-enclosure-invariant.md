# Agent Note: Every session event is enclosed in a turn

Status: implemented
Archived: 2026-07-28

English | [中文](2026-06-15-turn-enclosure-invariant.zh.md)

## Problem

A durable session-persistence backend (added in a companion change) uses the **turn** as its crash-recovery boundary: a crash can leave an unclosed final turn, which `load` closes with a synthetic `turn/end {kind:'interrupted'}` while preserving the turn's real events (see [session persistence](2026-06-14-session-persistence.md)). This recovery is only well-defined if nothing *legitimately* durable sits OUTSIDE a turn — between the last `turn/end` and the next `turn/start` — since such an event would be swept into the next turn's interrupted close.

That assumption did not hold. Two paths recorded events outside any turn:

1. **Queued user messages.** The loop drained queued messages and appended `user/message` *before* `turn/start` — so a turn's own prompt sat in the gap between the previous `turn/end` and the next `turn/start`.
2. **Idle context injection.** `agent.inject()` appends a `context/message` directly. Its real production caller is `dsh-tool-bash`, which injects a background-task completion notice from `ctx.bash.onTaskDone` — a callback that fires whenever a background bash task finishes, frequently while the agent is **idle** (between turns).

In case 2, if the injected `context/message` is the last event before a flush/dispose (no later turn appends a `turn/end`), `scanLog` treats it as crash debris and **drops it on resume** — the injected context is durably on disk but silently lost on reload. Case 1 was benign in isolation (a `user/message` is always followed by the turn it triggered) but made the "what may appear outside a turn" rule fuzzy.

## Decision

**Every session event lives inside a turn** — between a `turn/start` and its matching `turn/end`. Concretely:

- The loop appends queued `user/message` events **after** `turn/start` (inside the turn), not before it. `turn/end` is therefore owed the moment those messages are recorded, and the existing finalizer guarantees it.
- An `agent.inject()` made while the agent is **running** joins the already-open turn. While the current step executes assistant tool calls, accepted context waits in arrival order until that batch settles, then appends after every recorded result and before the turn closes even when execution is interrupted.
- An `agent.inject()` made while **idle** wraps its `context/message` in a one-shot turn: `turn/start{trigger:{kind:'injection'}}` → `context/message` → `turn/end{completed}`. A new `injection` variant joins the merge-extensible `TurnTriggerMap`.
- The loop derives the next turn number from the log each iteration (`lastTurnNumber(session) + 1`) instead of keeping a private counter, so an idle injection's one-shot turn cannot collide with the next real turn's number.
- The `dsh-session/invariant` companion registers the check with `ctx.invariants`: when selected, a `user/message` / `context/message` / `steering/message` appended while no turn is open throws an `InvariantError` attributed to `@deepseek-ai/dsh-session`.

The serializability invariant is enforced at the same source boundary (`Session.append` throws on non-JSON-serializable data), so "what may enter the log" is now governed in one place rather than discovered downstream by whichever backend happens to be watching.

## Alternatives considered

**Relax the reader instead of constraining the producer** — let `scanLog` commit events that sit outside an open turn. Rejected: a single, checkable producer-side rule beats a more permissive boundary scan that has to reason about partial turns *and* loose between-turn events.

## Consequences

The turn is now the *single* durability/replay boundary, so [session persistence](2026-06-14-session-persistence.md)'s crash-recovery rule is complete, not merely sufficient: an interrupted final turn is closed (with a synthetic `turn/end {interrupted}`) and its real events preserved, with zero risk of conflating between-turn context into it, because there is no between-turn context. `scanLog` stays simple (one possibly-open final turn, never a loose between-turn event), and an idle background-task notice survives persist + resume.

Costs: `agent.inject()` while idle now writes three log lines instead of one, and the derived history gains a turn that carries only injected context (no assistant output) — `deriveMessages()` already derives purely by event type, so this renders identically. The `injection` trigger is a new on-disk vocabulary value; like every `SessionEventMap`/`TurnTriggerMap` addition it is part of the frozen format. Event ordering within a turn changed (`turn/start` now precedes `user/message`), which is observable to anything that asserted the old order — the loop's own tests were the only such consumers.

The rule is intentionally producer-enforced and dev-checked rather than reader-tolerated: a future backend (SQLite/WAL) inherits the same clean boundary for free, and a plugin that records an event outside a turn fails loudly in dev instead of silently losing data on the next reload.

Failures detected during a turn are logged before `turn/end`. A later flush failure has no valid in-turn position, so it is reported through `agent/error` and logging rather than appended as a session event. This preserves a balanced replay log; durable operational diagnostics require a separate telemetry channel.
