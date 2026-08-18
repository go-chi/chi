# dsh-agent-tool-presentation

English | [中文](README.zh.md)

The row an [agent preset](../../preset/agent-presets/README.md) carries to say which form of its tools the model sees: `native` (every schema), `code` (only `run_code` plus a generated TypeScript SDK), or `both`.

## Why a row rather than a registry

The tool registry cannot move into a preset. Its consumers are all host-plane — [`dsh-agent-loop`](../agent-loop/README.md) reads its scheduler, [`dsh-apiproxy`](../../host/apiproxy/README.md) reads its presenters to render tool cards, and every tool plugin registers into it — and a service only moves down when all of its consumers move with it.

What a preset can own is the **presentation** of that registry. `ctx.tools.presentAs()` declares it for the mounting agent alone, so a Code Mode session runs beside native ones in one process, each seeing its own catalog. The deployment's `mode` on the [`dsh-tools`](../tools/README.md) row remains the default that agents declaring nothing get.

## What it does

`native` applies immediately. A code mode instead waits for `ctx.codeRuntime`, which is a host-plane service ([`dsh-code-runtime-worker-thread`](../../code-runtime/code-runtime-worker-thread/README.md)): a preset selecting Code Mode against a deployment composing no runtime then holds this row pending, and `dsh-agent-presets` refuses the mount naming this id. The alternative — applying optimistically — moves the failure to the session's first request, where the operator can act on neither the preset nor the composition.

`mode` is required rather than defaulted, because a preset without this row already gets the deployment default; an omitted value would mean the row was composed for nothing.

One agent declares one presentation. A second declaration in the same composition is refused rather than merged: two answers to "which form does the model see" is a contradiction, not an override.

## Model Experience

Indirectly, through the projection it selects in `dsh-tools`: `code` presents `run_code` plus a generated SDK section and the rule that only `run_code` may be called directly, `native` presents every tool schema. The selection also decides what may EXECUTE: under `code` the registry resolves a model-direct call naming any other tool to `UNKNOWN_TOOL`, so this row is what keeps the announced surface and the callable surface the same for every agent it covers ([executor-collapse note](../../../.agents/notes/implemented/bug-fix/2026-08-07-code-mode-executor-collapse.md)).

#### KV Cache effect

No direct invalidation; the presentation is fixed when the agent is composed, so its request prefix is stable for the session's life.

## Known Limitations and Deferred Work

- **The runtime stays host-plane** — a preset can select Code Mode but cannot supply the TypeScript runtime it needs; a deployment that composes none can compose no code-mode preset.
