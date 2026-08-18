# Agent Note: What stays host-plane once presets own the agent plane

Status: implemented

English | [中文](2026-08-10-host-plane-ownership-after-presets.zh.md)

## Problem

[Per-session agent presets](2026-08-03-per-session-agent-presets.md) moved every model-facing row onto the agent plane, and each later fix has been one reader that assumed the world before the move. `tasks` came back to the host because a preset row outside its realm resolved it; `goals` never left for the same reason; a child agent's `toolFilter` was repaired once every model-facing tool became an ancestor contribution rather than a global one ([child agents join their parent's preset](../bug-fix/2026-08-10-child-agents-join-their-parent-preset.md)).

Two more readers were still on the wrong side of that line.

`dsh-token-meter` was disabled on the host and mounted inside each preset's `compaction` realm. It takes no configuration, keys every fold by `Session`, and registers no tool or prompt section — but it owns the `tokenUsage`, `contextPressure`, and `contextBreakdown` projection units, and `sessionProjections` is a process-wide table with no scope layering. A unit registered from inside one preset therefore answers for every session: whether a `minimal` session showed a context meter depended on whether some *other* session had mounted `standard` since boot, and a process that only ever ran `minimal` showed none at all.

Nothing named an agent that joined no preset. The join is a scope-parent link; without it the `tools`, `system-prompt`, and `skill` views resolve the empty global layer and the model receives nothing — no error, no empty catalog, just an agent that cannot act. That is how delegated subagents ran for as long as presets existed, and the same hole is open at every entry point that predates them.

## Decision

**The meter is host-plane.** `dsh-token-meter` returns to the host composition and leaves the presets' `isolate` map, so `compaction-basic` and `tool-result-pruner` resolve the one host instance from inside their realm. The presets keep the realm and the backend — what a preset chooses is whether its agent compacts, not whether its tokens are counted. This is the criterion `tasks` and `goals` are already read by, applied to a Service whose *projection* reach is what made preset ownership wrong: a unit whose empty value is indistinguishable from a real one cannot be per-composition while the table it registers into is per-process.

**An unjoined agent is named twice, at two different points.** `AgentPresets` logs one warning per agent published with a scope chain of length one while a roster is configured. The invariant companion fails instead — and at `system-prompt/assemble`, not at publication, because an unjoined agent is legal until it addresses a model: `recompose` binds exactly such an agent as its first link, and prompt assembly is the only caller that supplies an agent scope, so a host assembly and a standing mount are both correctly out of range.

Three limits stay open and are recorded where they bite rather than fixed here: projection key presence is not a per-session capability signal ([`dsh-session-projection`](../../../../packages/session/session-projection/README.md)); a superseded standing generation is never reclaimed, which the settings-page authoring flow turns into a per-save cost ([`dsh-agent-presets`](../../../../packages/preset/agent-presets/README.md)); and a temporary plugin mounted through `cordis_mount` belongs to the composition rather than the session that mounted it ([`dsh-tool-cordis`](../../../../packages/extensions/tool-cordis/README.md)).

## Testing

`apps/cli/tests/web-agent-presets.e2e.ts` reads `ctx.get('tokenMeter')` on the booted Web composition before any preset in the file mounts — a preset-side meter sits behind an `isolate` realm and is invisible to `ctx.get`, so the read is an ownership assertion rather than a mount-order coincidence — then asserts a `minimal` session's snapshot carries all three units.

`packages/preset/agent-presets/tests/mount.spec.ts` asserts the warning fires exactly once for a bare agent and not at all for a joined one. `tests/invariant.spec.ts` carries the negative control: an unjoined agent's assembly rejects, while a joined agent's assembly and a scopeless host assembly both pass.

## Alternatives considered

**Keep the meter in the preset and scope-layer the projection registry.** The precise fix, and much larger: `snapshot`, `checkpoint`, and the eager drive would each need a session→scope resolution that a cold read does not have without the api-proxy's `presenterScopeFor`. Rejected as disproportionate to one Service with no per-preset state at all; the general rule is documented on the registry instead.

**Veto publication for an unjoined agent.** Loud beats silent, and the registry supports it — a synchronous `agent/created` listener that throws rolls the creation back. Rejected because composing an agent outside the roster is legal: `recompose` documents the bare agent it then binds, and the ACP bridge, the SDK server, and the headless bundle all create one today. A veto would convert a capability gap into an outage.

**Check the join at `agent/created` in the companion too.** Rejected: publication cannot distinguish a missed join from an agent that will be bound later, so the check would reject a documented path. Prompt assembly can distinguish them.

**Move `plan-mode` and `tool-todo` off the agent plane for the same projection reason.** Rejected: both are genuinely per-preset capabilities, and their units compute an empty value for a session that never uses them, which clients already read by value (`plan.active`, an empty list). Only a unit whose empty value is indistinguishable from a real one — the meter — forces host ownership.

## Consequences

The context meter becomes a per-session fact instead of a function of mount history. A preset can no longer opt out of token accounting; no shipped preset did, and `minimal` now says it drops auto-compaction rather than the accounting.

The warning is advisory, so a deployment that adds a roster to the ACP or SDK-server entry points still starts agents with no tools — it just says so once per agent instead of silently. The invariant reaches only compositions that load `dsh-invariants`, which fences package tests and development hosts, not a shipped one.
