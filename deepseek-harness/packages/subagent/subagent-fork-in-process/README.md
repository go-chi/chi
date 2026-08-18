# @deepseek-ai/dsh-subagent-fork-in-process

English | [中文](README.zh.md)

The fork provider creates an in-process child seeded with the parent's completed conversation turns. It shares all run mechanics with spawn; the session seed is the only behavioral difference.

## Seed boundary

The parent's current tool-calling turn is still open when a subagent starts: its log contains the assistant tool call but not the matching tool result or `turn/end`. Copying that raw log would give the child an invalid, unbalanced session.

Fork therefore computes the contiguous prefix ending at the last `turn/end`. The child sees all completed parent turns and none of the in-flight turn. If the parent has not completed a turn yet, the seed is empty and the child behaves like a fresh spawn.

The seed transfers conversation history only. The child still receives a fresh flat registration scope; it does not inherit the parent's tool restrictions or authority.

## Start and capabilities

`start(request)` passes the completed-turn seed to [`startInProcessRun`](../subagent-in-process-driver/README.md) and awaits child publication. The shared driver owns cancellation, depth, customization, result reading, and disposal.

Fork advertises `{ outputSchema: true, depthLimit: true, toolFilter: true, persona: true }`, identical to spawn.

## Config

| Key | Meaning |
|---|---|
| `providerName` | Registry name on `ctx.subagents` (default `fork`). |
See [`dsh-subagent-spawn-in-process`](../subagent-spawn-in-process/README.md) for the run lifecycle, model inheritance, and depth tracking — all shared.

## Model Experience

### Child-agent history and envelope

#### What the model sees

The child receives the parent's balanced completed-turn surface prefix, then the new task content verbatim. A configured persona shadows prompt text in the child's fresh scope; a tool restriction filters its global wire schemas, executable lookup, and Code Mode SDK bindings but not standalone guidance. The parent's tool view and authority are not inherited. An optional structured-output request adds its child-only contract. The parent's current in-flight turn is excluded.

#### Token effect

Forking duplicates retained completed history into separate child requests; the child then accumulates its own tokens independently. Persona changes repeated prompt cost, filtering changes schema or generated SDK cost, and a first-turn fork has no inherited history.

#### KV Cache effect

The child may reuse the inherited byte-identical prefix under the same provider and model. Persona, tool-filter, generated-SDK, or route changes may invalidate reuse before inherited history; later child history is append-only. Shipped compositions therefore bind this provider to `backgroundMode: one-shot`, because a continuable child additionally carries the child-scoped `report` tool and its prompt section — deltas that precede the inherited history and so invalidate all of it ([the fork-one-shot Agent Note](../../../.agents/notes/implemented/architecture/2026-08-10-fork-children-stay-one-shot.md)).

### Parent tool result, indirectly

#### What the model sees

The parent receives only the child's own final output through `dsh-tool-subagent`, not the inherited prefix or intermediate work.

#### Token effect

Parent input grows by one data-dependent final result retained until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **The seed is a one-time snapshot** — the child sees the parent's completed turns as of the fork and nothing the parent logs afterwards; there is no live context sharing.
- **No shipped composition creates a continuable fork child** — `prepareContinuable` remains implemented and the seam accepts it, but every shipped `cordis.yml` sets `backgroundMode: one-shot` on the fork delegation tool, so the provider's continuable path has no production caller. Reopening it requires the child's system prompt and tool schemas to match the parent's byte for byte, which the [`report` return channel](../tool-subagent-report/README.md) currently prevents. Rationale and the reintroduction condition: [the fork-one-shot Agent Note](../../../.agents/notes/implemented/architecture/2026-08-10-fork-children-stay-one-shot.md).
