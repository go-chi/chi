# Agent Note: The continuable child return channel is an obligation

Status: implemented

English | [中文](2026-08-06-continuable-child-report-obligation.zh.md)

## Problem

A continuable background child owns its own Session, so nothing it writes there reaches the agent that started it. [The report tool](2026-07-30-continuable-subagent-report-tool.md) gave that child a return channel and then presented it as one option among several: the schema said "call this zero or more times", nothing in the child's prompt asked it to call the tool at all, and the accepted default scheduling (`quiet`) added the report to a parked parent's next request without waking it.

Each of those choices is defensible alone. Together they made the return channel unusable as a delegation contract. A child that finished its work, wrote its answer into its own transcript, and stopped left the parent with nothing; a child that did report reached a parent that had already parked and would not read the report until something unrelated woke it. External reports of parents busy-polling `list_agents`, re-sending messages to settled children, and abandoning `subagent` for `workflow` all reduce to the same missing guarantee.

## Decision

The return channel is an instruction the child receives, not a capability it may discover. The report package installs two scope-local registrations into every continuable in-process child, and one disposer revokes both:

- the `report` tool, whose description now states that the child calls it once before finishing with a self-contained final result, and earlier for progress that changes what the parent should do next;
- a `tool:report` system-prompt section at order 117 carrying the same obligation in the child's own voice, so a child that never reads tool descriptions closely still receives it.

`reportDelivery` now defaults to `wakeup`. An accepted report creates exactly one ordinary later parent turn and wakes a parked parent driver; it still never steers an open turn. `quiet` remains available for deployments that prefer unread reports over turn amplification.

### Why the section and the description both exist

They address different failure modes. The tool description is read when the model is already considering `report`; the prompt section is read when it is deciding whether it is finished. The obligation belongs at both points because the failure this fixes — a child that simply stops — happens at the second one.

The section is registered on the child's own scope, the same mechanism [child composition](../../../../packages/subagent/subagent/src/child-agent.ts) already uses for a shadowing persona, so the parent and every sibling see neither the tool nor the guidance. `installReportTool` rolls the section back if tool registration fails, and its returned disposer attempts both revocations before surfacing cleanup failures.

### Instruction, not enforcement

Nothing rejects a child that never reports. No runtime path inspects whether a report was sent, and `report` still accepts zero or many calls per turn. The change is model-facing wording plus a scheduling default; the service authority, acknowledgement, and recovery contracts are unchanged.

That boundary is deliberate: prompt text can only reach a child that is still running its own loop. A child stopped by an error, a token ceiling, cancellation, or teardown never gets the chance to comply, which is why the runtime keeps its own account of settlement rather than trusting this instruction ([manager-owned settlement delivery](2026-08-06-manager-owned-subagent-settlement-delivery.md)).

### Snapshot coverage

The assembled ACP `subagent-report` scenario now exercises the shipped default: the child reports, the parked parent takes one ordinary turn on that report, and a later prompt still reads the report back out of the durable log. Because the child's scope now composes a prompt the class pin cannot describe, the snapshot harness gained `pinsChildSystemPrompts`, the exact counterpart of the existing `pinsChildToolSchemas`: it moves one child fixture's prompt into `system-prompt.<n>.expected.md`, leaves every other request-header field to the class pin, requires the sidecar exactly when declared, and rejects a sidecar identical to that class pin so a redundant copy cannot drift.

## Alternatives considered

**Keep `quiet` as the default and rely on the prompt alone.** This was the shipped position, and it supersedes nothing on its own: a report the parent never reads is indistinguishable from a report never sent. The [report-tool note's](2026-07-30-continuable-subagent-report-tool.md) rejection of always-waking assumed the parent had another reason to look at its context; a parked background coordinator does not. Turn amplification is the real cost, and it is now the reason `quiet` still exists rather than the reason it is the default.

**Let the child choose the delivery mode per call.** Unchanged from the original rejection: the model would own scheduler pressure, and behavior would vary per call rather than per deployment.

**Put the obligation only in the tool description.** A description is read while choosing among tools. The child this change targets is not choosing a tool; it believes it is done. Prompt guidance is the surface that reaches that decision.

**Enforce the obligation at settlement by rejecting a silent child.** There is nothing to reject: by the time settlement is observable the child's loop is over, and failing its teardown would destroy work rather than deliver it. Delivering the terminal facts unconditionally from the runtime is the answer to that case, and it belongs to the continuation manager, not to this package.

## Consequences

- Every continuable in-process child with this package loaded carries one extra prompt section and a longer `report` description in every request; no other Agent's request changes.
- The default deployment wakes the parent once per accepted report. A nested tree that reports frequently consumes extra parent turns; `quiet` is the documented escape.
- `installReportTool` requires `ctx.systemPrompt` in the child scope, so the package declares `systemPrompt` in `inject` and fails at load rather than at the next child materialization.
- Unit coverage pins the new default, two load-bearing instruction phrases, the section's child-only scope against both the parent and a sibling, and rollback or revocation of both registrations.
- Three assembled ACP scenarios with continuable children pin the complete instruction text through the new sidecar; a future change to any child-scoped section fails those scenarios instead of passing silently.

### Accepted risks

Waking by default amplifies model work in deep trees. The deployment owns that through `reportDelivery`, and the amplification is bounded by one turn per accepted report.

A child can still finish without reporting, and this change cannot detect it. Only the runtime's own [settlement account](2026-08-06-manager-owned-subagent-settlement-delivery.md) closes that case.
