# @deepseek-ai/dsh-subagent-spawn-in-process

English | [中文](README.zh.md)

The spawn provider creates a fresh child `Agent` in the current process. The child has its own session, sees no parent conversation history, and reuses the host's agent factory and LLM/tool services.

## Behavior

`start(request)` delegates to [`startInProcessRun`](../subagent-in-process-driver/README.md) with no seed and awaits publication before returning. The child receives parent working-directory/session lineage and inherits the parent model unless overridden, but starts with an empty conversation.

The shared driver owns depth checking, persona and tool-filter setup, structured output, required-signal cancellation, one-shot execution, result reading, and quiescent disposal. A startup rejection leaves no published child; provider unload after fulfillment does not revoke the holder-owned run.

## Capabilities

Spawn advertises `{ outputSchema: true, depthLimit: true, toolFilter: true, persona: true }` because it controls the child's creation window and can enforce all four features.

## Config

| Key | Meaning |
|---|---|
| `providerName` | Registry name on `ctx.subagents` (default `spawn`). |

## Model Experience

### Child-agent request

#### What the model sees

The fresh child receives the standalone task content verbatim, inherits the parent model and workspace by default, and sees the global prompt with any configured child-scoped persona shadow. A tool filter removes global wire schemas, executable lookup, and Code Mode SDK bindings for that child but leaves independently registered guidance. It receives zero parent conversation messages; the filter is visibility/composition, not an authority grant inherited from the parent.

#### Token effect

The child pays for a new independent context and history; no parent-history tokens are duplicated. Persona changes this child's repeated prompt cost, while filtering changes its schema or generated SDK cost.

#### KV Cache effect

Independent of the parent request cache. Child history grows append-only, while persona, tool-filter, generated-SDK, provider, or model changes establish a different child prefix.

### Parent tool result, indirectly

#### What the model sees

Through `dsh-tool-subagent`, the parent receives only the child's final output or stop-reason error.

#### Token effect

Parent input grows by one data-dependent result retained until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Fresh means no parent transcript** — the child inherits cwd, lineage, model, and explicitly configured persona/tool restrictions, but none of the parent's conversation; use the fork provider when completed-turn context is required.
