# dsh-session-checkpoint-policy

English | [中文](README.zh.md)

Semantic durability policy for persisted agents. It checkpoints the event-sourced session before a model adapter receives a request, before a top-level tool body may produce an external side effect, and at each `agent/pre-step` boundary so the preceding response and ordered tool results are durable before the next request.

## Plugin (namespace: `session-checkpoint-policy`)

This zero-config function plugin consumes `ctx.sessions`, `ctx.llm`, `ctx.tools`, and the presence of `ctx.sessionPersistence`. Load it beside one persistence backend:

```yaml
- id: session-persistence
  name: '@deepseek-ai/dsh-session-persistence-jsonl'

- id: session-checkpoints
  name: '@deepseek-ai/dsh-session-checkpoint-policy'
```

Persistence and checkpoint scheduling are intentionally separate Cordis plugins. A persistence backend starts bounded background batches for `session/event` appends and makes each requested `session/flush` an immediate quiescence barrier; this policy chooses the request, tool-dispatch, and next-step barriers. Loading a backend without this policy is valid, but a crash may lose events still inside the configured batching window or an outstanding write. First-party persisted apps and runtimes mount both plugins explicitly; a specialized deployment may deliberately omit or replace the policy.

The policy wraps `llm/stream` lazily, so the downstream stream is not constructed until the live session's buffered request events are durable. It wraps `tools/execute` after pre-execute policy and guards; a top-level tool body runs only after its recorded call is durable. If cancellation lands while that flush is pending, the wrapper returns the canonical `ABORTED_BEFORE_DISPATCH` result without entering the tool body. Nested tool dispatches reuse the outer model-visible call's checkpoint. `agent/pre-step` persists the preceding response/result batch before request derivation.

Checkpoint rejection is fail-closed at the model and tool boundaries: neither the adapter nor the top-level tool body runs. A step-boundary rejection fails the turn before another request starts. Concurrent tool checkpoints share the session store's serialized persistence drain and cannot duplicate sequence numbers.

## Model Experience

### Interrupted calls

#### What the model sees

The plugin adds no prompt or tool schema. A hard crash after a tool checkpoint but before its result leaves a durable unmatched call; session recovery supplies the model-visible `TOOL_OUTCOME_UNKNOWN` result owned by `dsh-session`. The message permits retry for read-only or idempotent work and requires state verification or user confirmation for calls that may have side effects.

#### Token effect

Successful checkpoints add no tokens and do not change the request. Recovery adds one short tool-result message to balance the interrupted transcript.

#### KV Cache effect

The repair result is appended after the reusable prefix, so it does not invalidate earlier cache entries.

## Known Limitations and Deferred Work

- The policy durably records execution intent, not generic exactly-once effects. Side-effecting tools should forward `exec.callId` as an idempotency key when their provider supports one.
- Streaming `assistant/chunk` events have no per-chunk checkpoint. Bounded background batches normally persist them before the next semantic checkpoint, but a hard crash may lose the current in-memory batch or outstanding write.
- A persisted call without a result cannot prove whether its external effect completed. Recovery therefore records an unknown outcome instead of retrying automatically.
