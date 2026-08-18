# @deepseek-ai/dsh-tool-ralph

English | [中文](README.zh.md)

The model-facing `ralph` tool runs a fixed foreground workflow that gives one immutable objective to a sequence of fresh child agents. It demonstrates a specialized orchestration policy as an ordinary plugin over [`ctx.workflowEngine`](../workflow/README.md) and [`ctx.subagents`](../../subagent/subagent/README.md): no Ralph mode or fresh-agent loop is added to `agent-loop`, and the same-session [goal domain](../../goal/goal/README.md) remains independent. The [Ralph Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md) owns the policy and deferred work.

## Contract

`ralph({ objective, maxRounds? })` waits for the entire run. The deployment config's `maxRounds` is both the default and a ceiling on a call override. Every Ralph round starts one child through `subagentProvider`; that provider must exist, support structured output, and report `inheritsParentContext: false`. The configured provider is carried as `WorkflowStartRequest.subagentProvider`, so the fixed script cannot inspect or change routing and the ordinary model-written `workflow` tool gains no provider selector. The resolved round cap is also carried as `WorkflowStartRequest.maxTotalAgents`, coordinating the fixed loop with the engine's total-child backstop; the engine rejects a Ralph cap above its deployment ceiling before publishing a run.

Each child receives only the immutable objective, its current Ralph round and cap, a shared-workspace-as-authority instruction, and the previous structured handoff. The workspace is long-term memory; parent conversation and prior child sessions are not seeded. Reports have `status: continue | complete | blocked`, a non-empty summary, evidence, next steps, and blocker text. Status-specific semantics and the serialized `maxHandoffChars` ceiling are validated inside the fixed workflow and again at the consumer boundary. Invalid, missing, or oversized reports fail the workflow instead of being truncated or mistaken for cap exhaustion.

The successful terminal tool result is `complete`, `blocked`, or `budget-limited`, with the last bounded report and number of rounds started. The canonical envelope is `{ runId, agentsStarted, result }`; completion and blocker labels in its Native renderer explicitly say that a worker reported the outcome, not independent certification. `maxResultChars` bounds only that rendered text including its truncation marker, without altering the validated report in the canonical value or the cross-round handoff.

An ordinary child failure produces an error naming the failed round and retaining the last successful handoff when one exists. Ralph does not retry that round. Fatal provider-start, transport, worker, or workflow failures remain workflow errors and may settle before the fixed script can return a handoff. Cancellation is also an error; partial output is never success.

## Lifecycle and cancellation

The caller's agent is the parent of every fresh child, preserving cwd and lineage without copying its conversation. `exec.signal` enters the workflow engine and is also bridged to `run.cancel()` for implementation independence. The tool awaits `run.result` and calls `run.dispose()` in `finally`, so a cancelled parent step waits for the engine's bounded termination and child quiescence before returning.

## Render intent

The pending call is a `generic` card titled `ralph`; the immutable objective is its `rawInput`. The result keeps the generic card. Both presentation functions depend only on tool arguments and the settled tool envelope.

## Config

| Key | Default | Meaning |
|---|---|---|
| `subagentProvider` | `spawn` | Fresh structured-output provider used for every round. |
| `maxRounds` | `256` | Default and deployment ceiling for one Ralph run. |
| `maxHandoffChars` | `16384` | Maximum serialized characters in one round report. |
| `maxResultChars` | `16384` | Maximum characters in the complete successful parent result. |

All config values are normalized and validated when the plugin applies, including direct application outside Loader schema normalization. Provider capabilities are resolved immediately before each call because provider registration can change under plugin lifecycle and HMR.

## Model Experience

### System prompt

#### What the model sees

Every parent request in this plugin's registration scope receives the fixed routing guidance below.

##### Ralph guidance

```markdown
Use the ralph tool ONLY when the direct human explicitly asks for a Ralph loop or fresh-agent iterative execution. Each Ralph round starts a fresh child with no conversation seed and uses the shared workspace as durable memory. Completion and blockers are worker reports, not independent evaluation. Use same-session goal tools for ordinary long-running objectives, and plain subagents or workflowEngine for bounded delegation and fan-out.
```

#### Token effect

Small fixed guidance cost per request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged. Activation or disposal may invalidate reuse from this prompt section.

### Tool schema

#### What the model sees

The generated [`ralph` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-ralph) exposes one required `objective` string and one optional `maxRounds` number. Provider choice, handoff size, report schema, workflow script, and orchestration behavior are deployment-owned and absent from the call schema.

#### Token effect

Small fixed schema cost on each request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged.

### Child requests and parent result

#### What the model sees

Each child sees the standalone fixed round prompt plus the structured-output capture contract. The parent sees only the original call and one terminal result containing a worker-reported status, round count, and pretty-printed final report; intermediate child messages and reports do not enter the parent conversation. A failed ordinary child instead yields an error with its round number and, after round one, the last successful handoff.

#### Token effect

Every round pays for a fresh child context. `maxHandoffChars` bounds cross-round state and `maxResultChars` independently bounds the complete successful parent text; child work remains outside the parent context.

#### KV Cache effect

Each fresh child has an independent request cache. The parent result appends after the reusable request prefix.

## Known Limitations and Deferred Work

- **Completion is worker self-declaration** — there is no independent evaluator or verifier deciding whether the objective is actually complete; evaluator policy and evaluator-driven continuation are deferred.
- **Foreground only** — there is no job id, background collection, process-resume checkpoint, scheduler, or wall-clock start policy.
- **The workspace is the only cross-round long-term memory** — one bounded report is the explicit handoff, and uncommitted conversational reasoning disappears with each child.
- **One round is one fresh child** — there is no within-round fan-out, model/provider switching, fork context, or model-call-selected provider.
- **Ordinary child failure is terminal for the run** — the fixed script reports the failed round and last successful handoff but does not retry; fatal workflow infrastructure failures can end before that state is returned.
- **Only round count bounds aggregate effort** — token, price, and elapsed-time budgets are deferred.
