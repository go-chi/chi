# Agent Note: Subagent lifecycle enrichment — lastAssistantMessage (observe-only)

Status: implemented
Archived: 2026-07-26

English | [中文](2026-06-30-subagent-observe-enrich.zh.md)

## Problem

The hooks subsystem ([interception seams Agent Note](2026-06-30-interception-seams.md)) lets a plugin observe and gate the agent at lifecycle points. Claude Code and Codex both expose **SubagentStart / SubagentStop** hooks, and CC's carry the subagent's final message. The harness already emits `subagent/start` and `subagent/end` lifecycle events ([the subagent capability-seam](2026-06-21-subagent-capability-seam.md)), but their payloads were minimal (`provider`, `id`, and on end `stopReason`) — not enough for a hooks bridge to report WHAT a subagent produced without separately reaching for the live run.

This Agent Note enriches the end payload. It is deliberately **observe-only**: no control-flow change and no waterfall. A run-affecting subagent-stop decision (continuation, injection that changes the run) is a separate, larger redesign and stays out of scope.

## Decision

**Add `lastAssistantMessage` — the child's final output — to `SubagentRunEndInfo`.** On the settle path it is the readonly typed `SubagentResult.output`, so an observer sees what the child produced without holding the run. On an infrastructure rejection where no `SubagentResult` exists, it is absent and the event reports `stopReason: 'error'`. Providers and listeners are trusted same-process collaborators and honor the borrowed immutable payload contract.

Both events stay plain **`emit`s**. Async `SubagentService.start()` attaches result observation to the ready provider run, emits `subagent/start`, and then returns the run; an in-process listener can therefore reach the published child via `ctx.agents.get(info.id)`, while a remote provider need not have a local registry entry. A rejected provider start emits neither event. The callbacks remain observe-only and per-listener containment keeps one bad subscriber from stranding a live run or starving later listeners.

## Alternatives considered

**An `agentType` subagent-kind label** (the harness analogue of CC's `subagent_type`) on the request + both lifecycle payloads — an earlier draft shipped it; dropped in review because it is a Claude-Code concept that does not fit our own seam (nothing here interprets it, and the only consumer was a CC-dialect bridge). The CC bridge instead feeds Claude Code's own default matcher value `"general-purpose"` for its SubagentStart/Stop `agent_type` matcher, so this Agent Note ships ONE enrichment: `lastAssistantMessage`.

**A control-flow `subagent/end`** — deferred; see below.

## Why observe-only, and what is deferred

A control-flow `subagent/end` (an awaited waterfall returning a stop/continue decision, like the other interception seams) would require: reshaping `subagent/end` from emit to waterfall, restructuring `SubagentService.start` to await listeners before settling, and implementing the `resume` capability in the in-process provider so a "continue" can actually re-run the child. That belongs to the background/steering subagent redesign the [capability-seam Agent Note](2026-06-21-subagent-capability-seam.md) already defers (the same redesign that unifies long-running-tool handling across subagents and bash). This Agent Note ships the observe-only enrichment a hooks bridge needs today; `FIXME(subagent-continuation)` / `TODO` anchors mark where the control-flow version would land if and when that redesign happens.

## Consequences

A hooks bridge (or a native plugin) can now forward the child's `lastAssistantMessage` to a SubagentStop handler by subscribing to the existing emits — no new control-flow surface. The vocabulary addition is documented in [docs/core-data-structures/subagent.md](../../../../docs/core-data-structures/subagent.md) (the events prose) and the two subagent READMEs; the catalog is regenerated. No production behavior changes — the events fire exactly as before, with one more (optional) field on the end payload — so no snapshot or e2e change is needed.
