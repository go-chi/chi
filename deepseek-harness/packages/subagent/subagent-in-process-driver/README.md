# @deepseek-ai/dsh-subagent-in-process-driver

English | [中文](README.zh.md)

This package is the shared run driver for the two in-process providers. Spawn passes no session seed; fork passes the parent's completed-turn prefix. Everything else—depth, child creation, optional child customization, result reading, cancellation, and disposal—has one implementation here.

## Start contract

`startInProcessRun(request, options): Promise<SubagentRun>` fulfills only after the child is published in `ctx.agents`. A rejected start has already quiesced the agent factory's unpublished creation transaction, so the caller never receives a half-created handle.

The driver follows this sequence:

1. Validate the parent depth and optional absolute `maxDepth`, then derive child depth as parent depth plus one and persist it in the child session header.
2. Call `parent.ctx.agents.create` directly, passing the required request signal into the factory's creation transaction.
3. During that transaction's unpublished setup window, install the requested persona, tool restriction, and structured-output runtime.
4. Publish the child, retain the returned `AgentHandle`, and drive one task with `child.followup(prompt)` followed by `child.whenIdle()`.
5. Read the child's own output — its last non-empty assistant message (an empty-content message that records usage is skipped), or its accumulated assistant text when no such message exists — and the final durable turn reason from the complete owned child run, excluding any fork seed.

The child gets the parent's working-directory/session lineage and inherits the parent provider, model, and output-token cap unless `request.agentOptions` overrides them. It gets a fresh flat registration scope: parent ownership does not import parent tool restrictions or establish an authority subset.

This result boundary is valid because the provider owns an isolated child lifecycle from publication through quiescence. Steering submitted during that lifecycle belongs to the child run; the provider does not pretend the initial follow-up alone owns its output.

The driver applies the seam's [delegated policy](../subagent/README.md#delegated-policy) through the shared child-agent helpers: it captures the parent's explicit sandbox override and the `'never'` approval pin before child creation and appends the source-tagged events during unpublished setup, after any fork history and before session publication. See the [delegation-policy decision](../../../.agents/notes/implemented/feature/2026-07-25-subagent-policy-inheritance.md).

## Cancellation and ownership

The required request signal covers both startup and the live run. Before publication, `AgentCreationTransaction` observes it, rolls back, and rejects. The factory detaches that creation-only listener before returning; the driver immediately checks the signal once more before installing a minimal live-run listener, closing the handoff race. After publication, abort cancels the child.

After fulfillment, the caller owns the run. Provider-plugin unload does not revoke it. `dispose()` removes the live abort listener, records cancellation, and delegates to the returned `AgentHandle.dispose()`, whose memoized quiescence transaction stops the loop, removes the agent and session, and unwinds scoped registrations. Cancellation owns every non-completed in-flight outcome and reports `aborted`; an already-completed turn remains completed.

## Spawn and fork inputs

`InProcessRunOptions` is `{ seed?: SessionEvent[] }`. Spawn omits it. Fork supplies a balanced completed-turn prefix and records its length so the result reader never mistakes a seeded parent message for child output.

Depth enforcement is internal to `startInProcessRun`: it reads the parent depth via `delegationDepthOf` (the persisted `SessionHeader.delegationDepth` is authoritative; runtime `AgentOptions.subagentDepth` may deepen but never lower it, so a resumed child keeps its budget), treats absence as top-level depth zero, rejects malformed stored values, and reports an attempted child depth above `maxDepth`. An unrepresentable depth above the safe-integer domain is a `RangeError`. The child depth is written to the child header, so it survives persistence and resume.

## Structured output

`attachStructuredRuntime(childCtx, schema)` installs the whole contract in the child's scope:

- A `structured_output` tool registered with the requested schema validates and stages the model's value.
- An order-190 system-prompt section tells the child that the tool call is the terminal answer.
- Both contributions are ordinary child-scoped registrations. An expert `system-prompt/assemble` listener may replace them and therefore owns preserving the structured-output protocol for that child.
- A `tools/result` observer commits a staged value only after that execution's authoritative final tool result succeeds, including the enclosing `run_code` result for Code Mode sub-dispatch.
- A monotonic tool guard blocks later calls after capture, and the structured-output execution's `concludeTurn()` marker ends the turn after the result commits.

A clean turn that never commits the required structured value reports `error`; the driver does not re-prompt. All registrations ride the child fiber and disappear with it.

## Model Experience

### Child-agent request

#### What the model sees

The shared driver sends the task verbatim as the child's user message and, when requested, shadows the persona and restricts global tool schemas, lookup, execution, and Code Mode SDK bindings in the unpublished child's fresh scope; parent restrictions are not inherited, and standalone tool-guidance sections remain. Spawn supplies no history; fork supplies its balanced seed.

#### Token effect

Child input is isolated from the parent and grows through the child's own steps. A persona changes repeated prompt text; filtering changes schema or generated SDK cost but not independently registered guidance.

#### KV Cache effect

Independent of the parent request cache. The child's later history is append-only, while persona, tool-filter, generated-SDK, provider, or model changes establish a different child prefix.

### Structured-output system prompt, schema, and results

#### What the model sees

A structured run adds the structured-output instruction below. It also adds a child-scoped `structured_output` definition with exact description `Report your final structured result. Call this exactly once, when your answer is complete; the arguments must match this tool's parameter schema exactly.` and the requested schema. This runtime-only definition is outside the generated shipped [tool package map](../../../docs/tool-catalog.md#tool-package-map). Its canonical acknowledgement is `{ recorded: true }`, rendered as `Structured output recorded.`; a later call becomes ``Error: structured output already recorded: the run is complete, so `<tool>` is not executed``.

##### Structured-output instruction

```markdown
When you have your final answer, you MUST report it by calling the `structured_output` tool with arguments matching its parameter schema exactly. Do not finish with a plain text answer: only the tool call counts as your result.
```

#### Token effect

Fixed instruction and capability tokens are paid only by that child. Result text enters the child history, while the captured value alone becomes the parent result.

#### KV Cache effect

Prefix-stable inside the child while the structured-output instruction and schema are unchanged. Changing the schema or capability may invalidate the child's cache from that early segment; results append in child and parent histories.

### Parent start error, indirectly

#### What the model sees

Through `dsh-tool-subagent`, invalid depth state becomes exactly `Error: agent subagentDepth must be a non-negative safe integer`, `Error: subagent child depth exceeds the safe-integer range`, or `Error: subagent depth <attempted> exceeds maxDepth <max>`. A pre-publication cancellation passes its abort reason through the registry's `Error: <message>` wrapper.

#### Token effect

Zero tokens on a successful start; only the failed parent tool call retains this text.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Parent result, indirectly

#### What the model sees

The driver extracts only the child's own last assistant output or captured structured value; seeded parent messages and intermediate child work do not become the result.

#### Token effect

The parent receives one data-dependent result through the consumer; all other child tokens stay in the child session.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Runs expose no `sendMessage`/`resume`** — the optional runtime capabilities are absent on in-process runs.
- **Structured capture accepts the `defineTool` schema subset only** — unsupported JSON Schema constructs fail before the child is created; a provider needing a broader schema vocabulary requires a different runtime.
