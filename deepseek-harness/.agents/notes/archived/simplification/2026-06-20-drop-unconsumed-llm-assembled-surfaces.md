# Agent Note: Drop unconsumed assembled LLM convenience surfaces

Status: implemented
Archived: 2026-07-26

English | [中文](2026-06-20-drop-unconsumed-llm-assembled-surfaces.zh.md)

## Problem

`LlmService` ([packages/llm/llm/src/index.ts](../../../../packages/llm/llm/src/index.ts)) exposes three call surfaces over a model:

- `stream()` — raw `StreamChunk`s, dispatched through the `llm/stream` waterfall.
- `streamBlocks()` — a "convenience view" that runs the chunks through a `BlockAssembler` and yields completed `ContentBlock`s in stream order ([index.ts:137-144](../../../../packages/llm/llm/src/index.ts)).
- `generate()` — one fully-assembled `GenerateResult`, dispatched through a second `llm/generate` waterfall ([index.ts:151-157](../../../../packages/llm/llm/src/index.ts)).

The only production consumer of the LLM service is the agent loop, and it uses `stream()` exclusively — feeding raw chunks through its own `BlockAssembler` so it can log chunks for replay fidelity while assembling in parallel ([packages/core/agent-loop/src/loop.ts](../../../../packages/core/agent-loop/src/loop.ts), the `ctx.llm.stream(req)` step). Grepping `streamBlocks` and `ctx.llm.generate` across `packages/*/src` and `examples/*/src` finds no production callers. The references are the service methods, docs, and tests; adapter tests use `generate()` as a convenient driver, but they can hand-drain `stream()` through the same assembler helper without preserving a public production API.

This is the [drop-mutable-session-summary](2026-06-19-drop-mutable-session-summary.md) pattern: assembled-view APIs with tested contracts, consumed by tests rather than production. They were built speculatively for consumers that do not care about token-level deltas, but the one real consumer cares about deltas precisely so it can persist high-fidelity replay data.

`streamBlocks()` drags a dedicated slice of `BlockAssembler` behind it: `flushReady()` and `flushRemaining()` ([packages/llm/llm/src/assembler.ts:138-168](../../../../packages/llm/llm/src/assembler.ts)) plus the `flushed` cursor field exist only to support incremental in-order yield. `generate()` drags `GenerateResult`, `BlockAssembler.result()`, and the `llm/generate` waterfall as a second interception surface over the same underlying stream. The loop's assembler usage is `push()` / `message()` / `usage` / `finish` — not streaming flush or one-shot service assembly.

## Decision

`stream()` is the sole public LLM call surface. Remove `streamBlocks`, `generate`, its event/result types, and assembler helpers used only by that path. Adapter tests assemble the public stream through a local helper, while `BlockAssembler` retains only the operations with production consumers.

## Alternatives considered

**Keep `generate()` as a test-only convenience** — rejected: adapter tests hand-draining `stream()` through the shared assembler exercise the same streaming path production uses, and a public method whose only callers are tests is exactly the dead-surface shape [the drop-mutable-summary precedent](2026-06-19-drop-mutable-session-summary.md) retired. A future consumer that wants assembled blocks without deltas reintroduces a focused helper with that consumer.

## Verification

`streamBlocks`, `generate`, `llm/generate`, and the assembler helpers they alone required are gone with no new dead exports; both real adapters are exercised through `stream()` and the shared assembler; the loop behaves identically (ACP snapshot expected outputs unchanged); and the README, architecture doc, and module docs carry no mention of the removed surfaces.

## Consequences

- **It removes public methods from a core vocabulary package.** A future plugin that wants assembled blocks without deltas would need to call `stream()` and use `BlockAssembler` directly or reintroduce a focused helper with a real consumer. Given the pre-release "foundation over speculative future" stance ([AGENTS.md](../../../../AGENTS.md)), this is the right time to cut test-only public shape.
- **Adapter tests get a little more explicit.** They lose the ergonomic `generate()` wrapper, but that is useful pressure: tests exercise the same streaming path production uses.
- **Waterfall users lose `llm/generate`.** No production listener exists. Any future caching/retry/logging plugin should wrap `llm/stream`, which remains the single provider call path.

The size is modest, but it is a clean removal of speculative surface area from the LLM package, leaving one model-call contract for both production and tests.
