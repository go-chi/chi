# Agent Note: Drop `GenerateOptions.prefill` and `ToolSchema.strict` — request knobs with no working end-to-end path

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-04-drop-inert-request-knobs.zh.md)

## Problem

Two request-contract knobs rode the whole request pipeline, yet neither could do anything:

- **`prefill`** (`packages/llm/llm/src/types.ts`) had no production setter — the loop assembles `model`/`system`/`tools`/`messages` plus `sessionId`/`signal`, and the compaction backend adds only `maxTokens` — and BOTH adapters rejected it: `packages/llm/llm-deepseek/src/serialize.ts` and `packages/llm/llm-pi-ai/src/adapter.ts` each threw `LlmError('UNSUPPORTED')` on a non-undefined `prefill`. The field's entire observable behavior was two throws, each pinned by one adapter test. DeepSeek's chat-prefix completion is a Beta feature on a base URL neither adapter targets.
- **`strict`** (`ToolSchema`, same file) was threaded through `DefineToolOptions`/`defineTool` (`packages/core/tools/src/schema.ts`), the registry's `schemas()` allowlist (`packages/core/tools/src/index.ts`), the deepseek wire mapping (`packages/llm/llm-deepseek/src/serialize.ts`, whose wire-type note recorded that strict mode requires the `/beta` base URL the adapter does not use), a per-tool payload-patching pass in `packages/llm/llm-pi-ai/src/adapter.ts`, and a conditional `Strict:` row in the tool-catalog renderer (`scripts/gen-tool-catalog.ts`). No shipped tool set it — `rg` across every `tool-*` package src and `examples/` found zero `strict:` producers; the only setters were dsh-tools unit tests.

Both knobs were adapter-symmetric, so removal shed them from both twins together — the [twin-adapter design](../architecture/2026-06-13-twin-llm-adapters.md) is untouched.

## Decision

- `prefill` is removed from `GenerateOptions`, along with both adapters' UNSUPPORTED guards, the tests pinning the throws, the paste line in [core.md](../../../../docs/core-data-structures/core.md), and the adapter README rows documenting the rejection. The cookbook's UNSUPPORTED guidance ([adding-an-llm-adapter.md](../../../../docs/cookbook/adding-an-llm-adapter.md)) states the rule generically — a `GenerateOptions` field your provider cannot honor throws `LlmError(..., 'UNSUPPORTED')` — instead of using prefill as the example. The [content-block vocabulary Agent Note](../architecture/2026-06-11-content-block-vocabulary.md)'s consequences record prefill as producer-gated rather than as having a home, per [implemented/AGENTS.md](../AGENTS.md).
- `strict` is removed from `ToolSchema`, `DefineToolOptions`, `defineTool`, the `schemas()` allowlist, the deepseek serializer branch and its wire-type field, and the tool-catalog renderer's `Strict:` row. The pi-ai payload fixup is simplified to the unconditional scrub of pi-ai's own per-tool strict default (pi-ai stamps `strict: false` on every serialized tool; the hand-rolled twin sends no such field, so the scrub survives for wire parity, pinned by its serializer test). The setter tests and the core.md paste line are gone; both `GenerateOptions` and `ToolSchema` keep their rows in `scripts/type-equiv.manifest.json`, since each type survives minus a field.

This Agent Note deliberately does NOT touch `temperature`, `stop`, or `maxTokens`: those are honored end-to-end by both adapters and are the natural first targets of a request-mutating hook plugin on `agent/request`.

## Alternatives considered

### Why not keep them?

"An explicit UNSUPPORTED throw is honest contract behavior" — but a knob whose only implementation across both twins is rejection promises nothing, and deleting it upgrades the failure mode: an accidental setter becomes a compile error instead of a runtime throw. "Strict schema adherence is an officially documented provider feature with complete plumbing" — but a knob is not product surface until a shipped tool sets it AND an endpoint honors it; today neither is true. Each returns with its first real producer: `prefill` together with an adapter that implements chat-prefix completion (and a stated policy for adapters that do not), `strict` together with a tool that wants it and a beta-endpoint story.

## Verification

`rg prefill` returns only Agent Note records (this one and the [content-block vocabulary Agent Note](../architecture/2026-06-11-content-block-vocabulary.md)'s producer-gated consequence); a tool-schema-scoped `rg strict` returns only this Agent Note, the surviving pi-ai scrub, and unrelated prose such as `strictEqual`. Both adapters' contract tests pass without the guards, and the pi-ai fixup still scrubs the library's strict default — wire parity pinned by its serializer tests.

## Consequences

The shipped hook bridges set no request fields at all, and a request-mutating plugin (an `agent/request` waterfall listener) reaches for `temperature`/`stop` (kept, working), not a field adapters reject. If chat-prefix completion or strict mode become product features, the re-add lands with the adapter/endpoint work, where the contract can say what actually happens rather than "everyone throws".
