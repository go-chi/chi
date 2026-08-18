# Agent Note: Remove the `agent/steering` mirror emit

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-04-remove-agent-steering-mirror.zh.md)

## Problem

`agent/steering` was the last remaining transient mirror of a durable session event. The loop's steering drain appends the durable `steering/message { turn, content, source }` and, on the very next line, emitted `agent/steering(agent, turn, content, source)` — the identical fact as a fire-and-forget event (`packages/core/agent-loop/src/loop.ts`, `drainSteering`). It had zero production listeners: the only subscriber anywhere was a loop regression test asserting the emit carried `source` — the same fact the durable event already records one line above.

`agent/steering` duplicated the immediately preceding durable `steering/message` with the same payload. `agent/queued` remains the live-only signal because it fires before persistence and covers work that may be cancelled before entering the log.

Steering carries real production traffic — the hook bridges' turn-continuation decisions inject their reasons through `inbox.steer()`, landing as durable `steering/message` events that the hook-matrix expected outputs pin — and every one of those consumers observes the durable event. Nothing observed the mirror.

## Decision

`agent/steering` is removed from the agent event taxonomy: the declaration in `packages/core/agent/src/types.ts` (and its mention in the live-events JSDoc list there), the emit in `drainSteering` (whose then-unused `ctx` parameter went with it), the row in `packages/core/agent/README.md`, and the emit line in the loop-pseudocode blocks (the `packages/core/agent-loop/src/loop.ts` module doc and [architecture.md](../../../../docs/architecture.md)); the cordis catalog is regenerated without it. The one regression test pins source preservation on the durable `steering/message` event — the fact it pins lives on the log.

Three implemented Agent Notes stated the retention, and each is amended per [implemented/AGENTS.md](../AGENTS.md) to point here as the record of the removal: the [boundary Agent Note](2026-06-20-remove-agent-boundary-mirror-events.md)'s retained-list entry, the [stream-chunk Agent Note](2026-07-02-remove-stream-chunk-mirror.md)'s scope clause, and the [event-domain-semantics Agent Note](../architecture/2026-06-30-event-domain-semantics.md)'s transient-emit enumeration.

## Alternatives considered

### Why not keep it?

"It is a control signal, not a boundary" — but the taxonomy's operative distinction is mirrored-vs-live-only, not control-vs-boundary, and this event mirrored. A consumer that wants enqueue-time notification has `agent/queued` (with its steering flag); a consumer that wants drain-time notification is by definition asking for the moment `steering/message` is appended, which `session/event` delivers with the same payload plus durability. The rejected [retire-mid-turn-steering Agent Note](../../rejected/simplification/2026-06-20-retire-mid-turn-steering.md) defended the steering *capability* — `steer()`, the durable event, continuation forcing — all of which this removal keeps untouched.

## Verification

The `agent/steering` spelling survives only in Agent Note prose (this Agent Note, the three amended Agent Notes above, and the frozen [rejected steering-capability Agent Note](../../rejected/simplification/2026-06-20-retire-mid-turn-steering.md), whose text records the proposal it declined); the catalog is regenerated; the retargeted test pins source preservation on `steering/message`.

## Consequences

Zero production listeners existed to migrate, and both live-notification needs keep surviving homes: enqueue-time on `agent/queued` (with its `steering` flag), drain-time on `session/event` as the durable `steering/message` lands.
