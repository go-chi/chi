# @deepseek-ai/dsh-compaction-basic

English | [中文](README.zh.md)

The **basic compaction backend**: a `BasicCompactionEngine` implementing the `@deepseek-ai/dsh-compaction` Service Definition with reusable `ctx.tokenMeter` pressure, token-budget retention, and summarization as a direct one-shot `ctx.llm.stream()` call that replays the conversation prefix to reuse the provider's KV cache (interceptable at `llm/stream`).

This package owns the Service Provider role of the compaction capability — see the [Service Definition package](../compaction/README.md) for its contract and the [capability-seam Agent Note](../../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md) for the design.

## What it owns

This backend owns the compaction policy:

- **Measurement** — the singleton `ctx.tokenMeter` prices the latest canonical logged envelope and current surface at one consumed-log revision. Step-boundary pressure therefore includes the actual system prompt, tools, routing, assistant completion, tool results, buffered context, and steering.
- **Routed policy** — proactive pressure resolves capacity from the adapter that owns the latest durable provider/model route, then scales the default policy plus an optional exact-target override into concrete token budgets. Model discovery remains advisory and is not consulted.
- **Model-free pruning** — after pressure or canonical overflow qualifies, the optional [`ctx.toolResultPruner`](../compaction-tool-result-pruner/README.md) service rewrites oversized tool results before range selection. Compact-basic remeasures through `ctx.tokenMeter`, skips summarization when pressure becomes safe, and otherwise summarizes the pruned surface. Below-pressure step checks never prune.
- **Retention** — compact the oldest whole surface units while preserving a recent tail and balanced tool-call/result cuts through the [`dsh-compaction` boundary helpers](../compaction/README.md#tool-pairing-boundaries). Turn boundaries do not protect old steps inside a runaway turn. An open indivisible tail declines until it closes. The optional pruner can repair an oversized closed tool unit when its text-bearing result is the removable bulk; indivisible non-tool units and non-prunable tool remainders remain out of scope.
- **Convergence** — retry head-checkpoint compaction up to `compactionRetries`; reject a summary that does not shrink its source, and throw if retries cannot return below threshold.
- **Summarization** — a direct `llm/stream` call uses the configured provider/model pair and cap, falling back to the latest logged request target and then the agent target, without running the loop-only `agent/request` extension point. The call replays the conversation's own system prompt, tools, and shadowed-region messages verbatim, including image references, and appends the compaction instruction as the final user message, so it reuses the provider's warm prefix cache instead of invalidating it. The selected adapter must resolve or explicitly reject those images. It sets `GenerateOptions.purpose` to `compaction`, which adapters may forward as request attribution (the DeepSeek adapter sends `x-deepseek-harness-compact: 1`) without touching the model-visible body. Only returned text enters the checkpoint, excluding reasoning and tool calls that would leak private reasoning or create an orphaned call; image output fails with `UNSUPPORTED_CONTENT` rather than disappearing.
- **Framing** — the replacement user message marks established checkpoint context with `<compacted-summary>` tags. The raw summary remains on the `compaction/summary` event, and later automatic cycles merge the prior checkpoint.
- **Lifecycle** — all entry points share one bracket-first region transaction. It validates the range and live lock, appends `compaction/start` synchronously, prepares and awaits the summary, revalidates, appends `compaction/summary` plus the replacement, and makes exactly one closing attempt. Automatic and explicit-region calls require a numeric open-turn owner and whole-surface stability; the serial `agent/pre-step` listener checks pressure before request derivation, while canonical provider overflow enters through `agent/request-error` and authorizes retry only after durable surface progress. `compactNow()` reserves idle admission, uses `turn: null`, accepts append-only context outside its selected span, flushes every closed attempt, and releases admission in `finally`.
- **Overflow recovery** — provider-confirmed overflow needs no capacity metadata: it bypasses normal pressure and retention, prunes, then attempts one maximal balanced head reduction while leaving the newest indivisible unit. Retry is authorized whenever `surface.replaceGeneration` advances, including when pruning lands before later summary work throws. No replacement, an exhausted target-specific cap, cancellation, or an unknown/noncanonical error preserves the original provider failure.
- **Failure handling** — a live unmatched `compaction/start` is the durable lock. An unmatched marker before a newer `session/end-seed` is stale evidence from a prior lifecycle and does not block; one after that boundary reports `busy`. Summary and changed-span failures close with an error and leave the conversation surface untouched, though the attempt remains in the log. A failed close deliberately leaves a blocking orphan. Operational pressure failures warn and continue, while overflow-recovery failure preserves the original provider error only when no earlier replacement advanced the surface. Cancellation remains authoritative after cleanup and durability.

The protected `summarize()` method is the sole subclass hook. A template- or remote-summarizer subclass can override it while pressure, retention, cited source events, shrink validation, and shadowed-token accounting stay on `ctx.tokenMeter`. The hook returns the safe summary plus the complete provider output, call envelope, and usage when available (`{ summary, rawOutput?, llmStreamCall?, provider, model, maxTokens?, usage? }`); `llmStreamCall: true` means producing that result consumed exactly one call through this context's `ctx.llm.stream()` and requires complete `rawOutput`, while unmarked `rawOutput` does not identify the call path. The transaction preserves those fields on `compaction/summary`.

## Config (`BasicCompactionConfig`)

Every setting is optional. Top-level policy fields are defaults for every routed model; `modelPolicies` applies partial overrides to exact provider/model pairs. At pressure time, compaction-basic asks the owning LLM adapter for that route's context capacity and resolves absolute budgets. Unrecognized keys, duplicate targets, mutually exclusive retention forms, and a merged `retainRatio` that is not below `thresholdRatio` fail plugin load. An absolute `retainTokens` budget that is not below its scaled threshold fails on the first resolvable target because that comparison requires model capacity.

| Key | Required | Meaning |
|---|---|---|
| `thresholdRatio` | no (default `0.8`) | Compact at `floor(routedContextWindow × ratio)`. |
| `retainRatio` | no (default `0.16`) | Recent surface budget kept verbatim as a fraction of the routed context window; mutually exclusive with `retainTokens`. |
| `retainTokens` | no | Absolute recent surface budget kept verbatim; mutually exclusive with `retainRatio` and must be below the resolved threshold. |
| `summarizationProvider` | no (default `''`) | Set together with `summarizationModel`; an empty pair resolves the latest logged request target, then the `AgentOptions` pair. |
| `summarizationModel` | no (default `''`) | Set together with `summarizationProvider`; an empty pair resolves the latest logged request target, then the `AgentOptions` pair. |
| `maxTokens` | no (default `8192`) | Provider generation cap for the summarization call; may include reasoning tokens. |
| `compactionRetries` | no (default `1`) | Extra attempts after the first when pressure remains above threshold. |
| `maxOverflowRetries` | no (default `1`) | Maximum retries after canonical context-window overflow; `0` disables recovery only. |
| `modelPolicies` | no (default `[]`) | Exact `{ provider, model, ...partialPolicy }` overrides; matching uses both fields and does not depend on `listModels()`. |
| `auto` | no (default `true`) | Register step-boundary pressure and overflow-recovery listeners. Set `false` for manual-only. |

Every `modelPolicies` entry accepts the policy fields above except `auto` and `modelPolicies` itself. If an entry supplies either retention field, it replaces the default policy's retention choice; otherwise retention is inherited. Summarization provider/model remain a pair inside each entry.

An adapter may return no capacity for a valid dynamic route, and resolved capacity may expose an invalid absolute retention budget. Manual pressure checks then throw a target-specific configuration error; the automatic listener warns once for that exact target and continues with full history. Unrelated operational failures remain independently visible. Canonical provider overflow still attempts recovery because the provider has already established that compaction is necessary.

## Usage

`BasicCompactionEngine` requires `ctx.llm`, `ctx.tokenMeter`, and `ctx.sessions`. The composition below receives `ctx.llm` from its host and installs the other two services:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import SessionStore from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'

export const name = 'compaction-basic'
export const inject = ['llm']

export function apply(ctx: Context): void {
  ctx.plugin(SessionStore)
  ctx.plugin(TokenMeter)
  ctx.plugin(BasicCompactionEngine)
}
```

Loading the plugin registers `ctx.compaction`. Add [`dsh-compaction-tool-result-pruner`](../compaction-tool-result-pruner/README.md) as a sibling before this plugin to enable the optional model-free pass. With `auto: true` (the default) it compacts automatically under token pressure. The sibling [`dsh-command-compact`](../command-compact/README.md) calls `ctx.compaction.compactNow(...)`; programmatic callers may also use any seam operation directly.

For example, the same compact plugin can safely serve models with different capacities and one target-specific policy:

```yaml
- name: '@deepseek-ai/dsh-compaction-basic'
  config:
    thresholdRatio: 0.8
    retainRatio: 0.16
    modelPolicies:
      - provider: local
        model: small-context
        thresholdRatio: 0.7
        retainTokens: 2048
```

## Model Experience

### Conversation history

#### What the model sees

After a successful step crosses the threshold, oversized tool results are first rewritten when the optional pruner is loaded. If summarization remains necessary, the next request receives the checkpoint preamble below, a blank line, `<compacted-summary>`, the data-dependent summary, and `</compacted-summary>`. Overflow recovery rebuilds the immediate retry from whatever replacement advanced the surface. A checkpoint replaces the selected older range and is followed by the retained recent units.

##### Conversation checkpoint preamble

```markdown
This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.
```

#### Token effect

Model-free pruning can avoid the auxiliary call entirely; otherwise it reduces that call's transcript before the summary replaces an older range. The replacement reduces future input history rather than appending a second copy. A summary remains until a later compaction replaces it, while an indivisible non-tool unit can still exceed the budget.

#### KV Cache effect

Replacing rather than append-only. Each checkpoint invalidates reuse from the first replaced history token; the unchanged request prefix before that range remains reusable.

### Auxiliary summarizer request

#### What the model sees

The summarization model receives the conversation replayed verbatim — the same system prompt, tool schemas, and messages the last routed request sent for the shadowed region — followed by one final user message: the compaction instruction below. The conversation model never sees this private request or its reasoning; only returned text is stored.

##### Compaction instruction (final user message)

```markdown
You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.

Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.

## Primary Request and Intent
- [the user's original and evolving goals; quote verbatim where the exact wording matters]

## Key Technical Concepts
- [technologies, frameworks, patterns, and conventions in play]

## Files and Code
- [exact path: why it matters, key changes or snippets]

## Errors and Fixes
- [error: how it was resolved, plus any related user feedback]

## Pending Jobs
- [explicitly requested work not yet completed]

## Current Work
- [precisely what was in progress at this checkpoint]

## Next Step
- [the single next action, directly in line with the most recent request, or "(none)"]

## Critical Context
- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]

Rules:
- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.
- Capture user feedback and explicit instructions faithfully, especially corrections.
- Do NOT mention this summarization request or that the context was compacted.
- Output only the checkpoint text: do not call any tool or take any other action.
- If the conversation already contains a <compacted-summary> block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.
```

#### Token effect

This is a separate model call: the replayed conversation prefix plus the fixed instruction as input, with `maxTokens`-capped output. Convergence retries can pay this cost more than once.

#### KV Cache effect

The replayed system prompt, tools, and shadowed-region messages match the conversation's last routed request byte-for-byte, so the provider's warm prefix cache is reused up to the trailing instruction; only that instruction, and the summary output, is uncached. Routing the summarizer to a different provider/model, or compacting a non-head range, forgoes this reuse.

## Known Limitations and Deferred Work

- **Meter accuracy follows the fixed heuristic** — missing reusable provider usage falls back to character count plus structural overhead rather than exact tokenization.
- **Overflow classification is adapter-maintained** — provider wording can change; both DeepSeek adapters normalize currently recognized context-limit failures to `CONTEXT_WINDOW_EXCEEDED`.
- **Some indivisible-unit and envelope-only overflow remains outside surface compaction** — recovery cannot shrink system/tools/prefix, split an indivisible non-tool node, or repair a tool unit whose non-prunable remainder still exceeds the window. The optional pruner can shrink text-bearing tool-result bulk inside an otherwise indivisible pair.
- **`compactRegion` requires an open turn** — a manual call on a fully-closed session throws ("no open turn") rather than compacting.
- **Summarization failure preserves the latest durable surface** — before any replacement, the auto path logs a warning and proceeds with full over-budget history. If pruning already landed, a later summarization failure proceeds from that durable pruned surface. Summarization truncation at `maxTokens`, which hidden reasoning tokens can consume, follows the same rule.
