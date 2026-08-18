# Agent Note: Prune producer-less vocabulary variants (block cache hints, the `agent` message source, the `continuation` turn trigger)

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-04-prune-producerless-vocabulary-variants.zh.md)

## Problem

The merge-extensible vocabulary maps are designed to grow by declaration merging, and the codebase already states the admission policy on `TurnEndReasonMap` (`packages/core/session/src/types.ts`): a variant like `refusal` is "deliberately omitted until" an adapter or loop first emits it. Three declared vocabulary items violated that policy — each had no producer and no consumer, and two had not even a test:

- **`CacheHint` and its `cache?: CacheHint` block fields** on `TextBlock`/`ToolResultBlock` (`packages/llm/llm/src/types.ts`; the image block carried a third such field, which left with it — see [the drop-image Agent Note](2026-07-04-drop-image-content-block.md)). Nothing constructed a block with `cache:` anywhere — src, tests, and doc pastes all came up empty — and neither adapter read `.cache`: DeepSeek prompt caching is automatic, so the adapters map `prompt_cache_hit_tokens` OUT of responses without ever sending a hint IN. This was Anthropic-style `cache_control` surface with no provider that could honor it.
- **`MessageSourceMap.agent`** (`{ kind: 'agent'; agentId: string }`, same file). Zero constructors, tests included. Its intended producer shipped without it: the subagent backends send the parent's prompt to the child with no `source`, so it logs as `{ kind: 'user' }`, and the generic envelope renderer interpolates `source.kind` without ever routing on it.
- **`TurnTriggerMap.continuation`** (`packages/core/session/src/types.ts`). The loop structurally cannot emit it — continuation happens *within* a turn as further steps, never as a new turn — and it constructs only `message` and `injection` triggers. The only writer was one hand-built test fixture needing an arbitrary non-message trigger (`packages/support/llm-replay/tests/llm-replay.spec.ts`), which an `injection` trigger serves equally; the only production trigger reader, the ACP bridge, filters on `kind === 'message'`.

## Decision

`CacheHint`, its `cache?` block fields, the `agent` message-source variant, and the `continuation` turn-trigger variant are deleted: the shipped vocabulary carries none of them. The llm-replay fixture uses an `injection` trigger (any non-`message` trigger serves its purpose). The type-equiv pastes in [core.md](../../../../docs/core-data-structures/core.md) and [session.md](../../../../docs/core-data-structures/session.md) match the pruned maps — both symbols keep their rows in `scripts/type-equiv.manifest.json`, since each map survives minus a member — and the [content-block vocabulary Agent Note](../architecture/2026-06-11-content-block-vocabulary.md)'s consequences record cache hints as producer-gated rather than as having a home, per [implemented/AGENTS.md](../AGENTS.md).

Each variant returns the day it gains a real producer, exactly as the maps are designed to grow: a caching feature re-adds `cache` together with the adapter that transmits it; subagent attribution re-adds `agent` together with the backend that stamps it and a consumer that routes on it; an auto-continue feature that genuinely starts new turns re-adds `continuation` with the plugin that emits it.

## Alternatives considered

### Why not keep them?

The [content-block vocabulary Agent Note](../architecture/2026-06-11-content-block-vocabulary.md) listed "cache hints … have a home" as a design consequence, and reserved slots do advertise intent. But an empty slot is contract surface every implementation and consumer must consider (must my adapter honor `cache`? must my renderer route `agent` sources?), and the sibling map's own JSDoc already rejects reservation-without-emitter — `refusal` and `max_turn_requests` are named as variants to add *when something first emits them*, not declared in advance. Holding already-declared dead variants to the same standard makes the vocabulary mean something: if it is in the map, something produces it.

## Verification

`rg` for `CacheHint`, the `agent` message-source spelling, and the `continuation` trigger spelling returns only Agent Note records (this one, and [the drop-image Agent Note](2026-07-04-drop-image-content-block.md)'s account of the image block's own `cache` field); the llm-replay fixture asserts the same replay behavior with an `injection` trigger; the core-data-structures pastes and the type-equiv manifest are in sync.

## Consequences

Nothing operational changed — nothing could construct these values. The mirror-event removals ([the boundary-mirror Agent Note](2026-06-20-remove-agent-boundary-mirror-events.md), [the stream-chunk Agent Note](2026-07-02-remove-stream-chunk-mirror.md)) touch only transient `agent/*` events, never the durable vocabulary, so there is no collision. Elsewhere the admission policy already holds: `rejected`, `prompt/blocked`, and `hook/invoked`/`hook/result` each have live producers — this Agent Note extends the same bar to the three variants that lacked one. The image block's own `cache?` field belongs to [the drop-image Agent Note](2026-07-04-drop-image-content-block.md), which removed it together with the block; this Agent Note covers the two fields on the block types that remain.
