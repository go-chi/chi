# Agent Note: Stop mirroring the token stream as an agent event

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-02-remove-stream-chunk-mirror.zh.md)

## Problem

The loop records every model token delta as a durable `assistant/chunk` session event AND emitted a parallel live `agent/stream-chunk` Cordis event carrying the identical data. In `packages/core/agent-loop/src/agent.ts` the two sat one line apart:

```ts ignore-check
const chunkEvent = session.append('assistant/chunk', { turn, step, chunk })
chunkSeqs.push(chunkEvent.seq)
ctx.emit('agent/stream-chunk', agent, turn, step, chunk)   // ← the mirror
```

- Durable: `assistant/chunk: { turn, step, chunk }`.
- Live emit: `agent/stream-chunk(agent, turn, step, chunk)` — same `StreamChunk`, same `turn`/`step`.

The only thing the emit added over the session event was the live `Agent` handle, and the sole consumer discarded it (its handler signature was `(_agent, _turn, _step, chunk)`).

This is the same duplication the [boundary-mirror removal](2026-06-20-remove-agent-boundary-mirror-events.md) eliminated for turn/step boundaries: a consumer had two sources of truth for one durable fact, and every change had to touch both. That Agent Note deferred the chunk stream ("`assistant/chunk` persistence remains load-bearing, so the chunk stream could later be evaluated as a mirror, but that is a separate decision") rather than bundling it in. This Agent Note is that separate decision.

The premise the deferral hinged on is settled: chunk persistence is authoritative and staying. The proposal to stop persisting chunks and keep only a transient live stream event was [rejected](../../rejected/simplification/2026-06-20-assembled-assistant-messages-only.md) — high-fidelity replay, partial failed streams, and snapshot replay all depend on the persisted `assistant/chunk` feed. So `assistant/chunk` on `session/event` is the durable, load-bearing token stream, and `agent/stream-chunk` is a pure redundant mirror of it.

## Decision

Remove `agent/stream-chunk` from the agent event taxonomy. The token stream is read off `session/event` as `assistant/chunk`, the same feed persistence and replay already use — `session/event` is the single live transcript stream (assistant chunks, turn/step boundaries, tool activity, todos).

**Consumers.** Persistence, replay, and interactive renderers consume the authoritative session stream directly. The [automation-only ACP bridge](2026-07-23-acp-automation-only-protocol.md) emits committed `assistant/message` text rather than raw chunks, so it needs neither event. No production consumer requires an `Agent`-first token mirror.

## Scope

Removed: `agent/stream-chunk`.

Not touched:
- `assistant/chunk` (the durable session event) — the authoritative token stream, kept exactly as-is. This Agent Note removes the LIVE MIRROR, not the persistence (the persistence-removal proposal was separately rejected — see above).
- `agent/steering` — not touched by THIS decision (a control signal, not the token stream). Its durable twin is `steering/message`, and the mirror emit was removed by its own follow-up: [Remove the `agent/steering` mirror emit](../../archived/simplification/2026-07-04-remove-agent-steering-mirror.md).
- `agent/status`, `agent/error`, `agent/created`/`agent/disposed`, `agent/queued`, `agent/session-start` — lifecycle/control events that are not transcript data and have no durable duplicate.

## Alternatives considered

**Remove the persistence and keep only a transient live stream** — the inverse cut, [rejected separately](../../rejected/simplification/2026-06-20-assembled-assistant-messages-only.md): high-fidelity replay, partial failed streams, and snapshot replay all depend on the persisted `assistant/chunk` feed. With that settled, the live emit is the redundant half of the pair.

## Consequences

A plugin can no longer observe token deltas from an `Agent`-first event. It subscribes to `session/event`, filters `assistant/chunk`, and looks up the corresponding live handle directly with `ctx.agents.get(session.id)` when needed. No production consumer needed the live `Agent` at chunk time; this is the same acceptable trade the boundary-mirror removal made.
