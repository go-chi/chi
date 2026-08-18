# Agent Note: Collapse workflows to the exercised foreground core

Status: rejected — Workflow progress is an intentional observation API; make it useful through a consumer instead of deleting it.

English | [中文](2026-07-12-collapse-workflow-to-foreground-core.zh.md)

## Problem

The workflow capability executes foreground JavaScript that composes subagents, but it also carries an unconsumed progress-observation system. No production listener subscribes to any of the six `workflow/*` events; listeners exist only in workflow tests. Nevertheless the seam defines run/phase/agent outcome payloads, the worker sends phase/log/agent lifecycle protocol messages, the host forwards them through a `liveAgents` pairing ledger, and the engine maintains run ids solely to correlate those notifications.

The progress vocabulary is not merely unused; it cannot serve its only named future owner without redesign. `WorkflowRunInfo` contains `{id, meta}` but no parent agent, session, or tool-call identity, while the model-facing tool never exposes the run id. A global ACP listener could not route an event to the correct client session. `meta.phases` is never consulted, `phase(title)` does not validate against it, phase `detail`/`model` and agent `label`/`phase` feed only events, and `whenToUse` is validated and copied but never rendered or selected. `phase()` and `log()` still cross the worker boundary despite having no receiver.

The live handle repeats event-era data after those observers disappear. `WorkflowRun.id` has no non-event consumer, while the tool reads `run.meta.name` only to render a value it already owns as `args.meta.name`; neither belongs on the execution/cancellation handle.

Cancellation also has two public channels for one synchronous start. `WorkflowStartRequest.signal` is passed to the worker host, while the sole production caller separately bridges the same signal to `WorkflowRun.cancel()`. Because `start()` returns the run before control can yield, there is no readiness window that requires request-time cancellation; the duplicate signal adds host listener/disarm state without closing a race.

`WorkflowError.fatal` is the same speculative branch in miniature: every production construction is fatal, `fatal: false` exists only in tests, and combinators already distinguish workflow failures with `instanceof`.

## Proposal

Keep the exercised core: `agent(prompt, { schema, model })`, `parallel`, `pipeline`, `args`, concurrency/agent caps, cancellation, bounded disposal, structured results, worker isolation, and foreground tool collection. Remove all `workflow/*` events and their event-only info/outcome types; remove `phase()`, `log()`, agent `label`/`phase`, phase declarations, `whenToUse`, and their worker messages/host observers; collapse workflow metadata to the name the tool actually uses; remove event-only run ids/meta snapshots and the synthesized agent-end ledger. Shrink `WorkflowRun` to `result`, `cancel()`, and `dispose()`; the tool renders the request-owned name. Remove `WorkflowStartRequest.signal` and the worker host's input-signal listener/disarm state, retaining the caller-owned bridge from its abort signal to `run.cancel()`. Make `WorkflowError` one fatal error class without a boolean mode or `isFatalWorkflowError()` helper.

Amend the implemented dynamic-workflow Agent Note and update the seam/tool/worker READMEs, tool schema, generated catalogs and package graph, worker type-equivalence records, unit tests, and workflow snapshot/header fixtures. Progress UI work, if commissioned, starts from a correlation contract that names the parent agent/session/tool call instead of reviving this protocol unchanged.

## Alternatives considered

**Keep the prebuilt observation vocabulary for a future UI.** The current shape resembles Claude Code dynamic-workflow metadata, and the host deliberately pairs each forwarded agent start with either the worker's end or a synthesized terminal end. Removing it gives up compatibility-by-shape and makes progress UI a new design task, but the existing payloads still lack routable ownership, so balanced lifecycles alone cannot make the named ACP owner viable without redesign.

## Acceptance criteria

- The workflow public contract contains only execution, cancellation, result, and disposal contracts with a production consumer.
- No workflow event, phase/log protocol message, run-id generator, progress-only metadata, host pairing ledger, or fatal-mode branch remains.
- The run handle has no id/meta echoes, and cancellation has one holder-owned channel after synchronous `start()` returns.
- Parallel/pipeline behavior, caps, cancellation quiescence, worker containment, structured output, and the model-facing workflow scenarios retain coverage.
- Typecheck, coverage, snapshots, doc-sync, module-graph verification, build, and hygiene pass.

## Risks

This is a compile-visible contraction of the workflow DSL, event taxonomy, handle, and start request. Existing workflow calls that supply descriptive metadata, and scripts that use `phase`, `log`, or labels, must shrink; programmatic callers bridge their own abort source to the returned handle; and a future observer must add a better-correlated event contract. The execution semantics that make workflows useful do not change.
