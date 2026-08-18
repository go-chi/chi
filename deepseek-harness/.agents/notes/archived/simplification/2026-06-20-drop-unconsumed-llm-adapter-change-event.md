# Agent Note: Drop the unconsumed `llm/adapter-change` event

Status: implemented
Archived: 2026-07-26

English | [中文](2026-06-20-drop-unconsumed-llm-adapter-change-event.zh.md)

## Problem

`LlmService.registerAdapter()` emits `llm/adapter-change` on registration and disposal ([packages/llm/llm/src/index.ts](../../../../packages/llm/llm/src/index.ts)). Grepping `llm/adapter-change` across `packages/*/src` and `examples/*/src` finds only the declaration, emit sites, docs, and tests; no production listener subscribes to it.

This differs from `tools/change` and `system-prompt/change`. Those two events are also unconsumed today, but they are plausible registry-change signals for future live tool/prompt UIs. LLM adapter registration is more of a boot-time implementation detail: adapters are not a user-visible palette and the real model-call interception seam is `llm/stream`. Keeping an adapter-change event with no listener repeats the [drop-the-dead-summary](2026-06-19-drop-mutable-session-summary.md) pattern at a smaller scale.

The event is not free. `registerAdapter()` yields its rollback disposer before emitting `llm/adapter-change` so a throwing listener unwinds the mutation instead of leaking an adapter entry, and the package carries tests for that listener-throw path. That defensive ordering protects a failure mode only tests can trigger.

## Decision

Only `llm/adapter-change` is removed: the declaration in `dsh-llm`'s `interface Events`, the `ctx.emit('llm/adapter-change')` calls, and the "Emits `llm/adapter-change` on registration and disposal" sentence in `LlmService.registerAdapter`'s JSDoc. `registerAdapter()`'s effect generator keeps the mutation and rollback disposer for HMR/disposal but sheds the listener-throw rollback ordering that existed only for the removed event. The adapter-disposer test asserts the returned disposer removes the adapter without subscribing to the event; the listener-throw rollback test is gone with its subject. The event taxonomy in [docs/architecture.md](../../../../docs/architecture.md) and [packages/llm/llm/README.md](../../../../packages/llm/llm/README.md) is updated in the same change.

## Alternatives considered

### Why not remove every registry change event?

A microkernel where registries announce mutations is a coherent convention. `tools/change` and `system-prompt/change` may become useful when a UI can live-refresh available tools or prompt sections. This Agent Note leaves that convention intact where it has a plausible user-facing consumer and cuts only the adapter-change event whose current and likely future consumer is unclear.

If an LLM adapter browser or dynamic model-picker needs this signal later, reintroduce it with that consumer and a clearer payload than "something changed."

## Verification

`llm/adapter-change` and its emits are gone and the regenerated cordis catalog is fresh; HMR-safety holds (disposing a contributing fiber removes the adapter); `tools/change` and `system-prompt/change` remain documented and tested; and the ACP snapshots plus the keyless Headless Loader smoke pin the unchanged production paths.

## Consequences

- **Removing a documented emit event is a public-surface change.** It is in the taxonomy table, so it reads as deliberate API. But "declared and emitted" is not "consumed" — the same distinction that justified dropping the mutable summary. The taxonomy table is updated in the same change, so the docs do not drift.
- **The registry-change convention becomes uneven.** That is acceptable because LLM adapter registration is not the same user-facing concept as tools or prompt sections. Uneven but honest beats uniform but dead.

This is a small cut, but it retires a standing correctness invariant that guards a consumer that does not exist.
