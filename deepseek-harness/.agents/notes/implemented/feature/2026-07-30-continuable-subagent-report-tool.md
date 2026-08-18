# Agent Note: Continuable subagent report tool

Status: implemented

English | [中文](2026-07-30-continuable-subagent-report-tool.zh.md)

## Problem

Continuable in-process subagents can receive later parent messages, retain descendants, settle, and cold-resume, but the base lifecycle gives them no way to send selected content back to their direct parent. Their complete output already remains reconstructable from the durable child Session, so the missing capability is explicit delivery rather than result storage.

Treating every final assistant message as an implicit result would conflate turn completion with reporting. A long-lived child may have nothing useful to report in one turn, may report progress several times in another, and must remain available after reporting. Recipient authority, quiet versus waking delivery, acknowledgement, durability, and retry behavior therefore need one explicit contract.

## Decision

Add the independently installed `@deepseek-ai/dsh-tool-subagent-report` package. It contributes an ordinary model-facing `report` tool to each continuable in-process child Activation. The mechanism accepts zero or multiple calls in a turn; the child is separately instructed to call it once before finishing ([the report obligation](2026-08-06-continuable-child-report-obligation.md)). Success neither concludes the turn, settles the Activation, nor prevents later parent follow-ups, and finishing a turn never reports automatically.

The feature is a collaboration control, not a result-bearing execution wrapper. It adds no Task, `SubagentRun`, result promise, Activation state, delivery queue, or replay path.

### Model-facing contract

`report` accepts exactly `{ output: string }` and returns exactly `{ messageId: string }`. It accepts no child id, recipient id, or delivery mode. `exec.agent` binds the tool call to the reporting child, the service derives the sole recipient from durable `parentSession`, and deployment config owns scheduling.

`messageId` is the stable `MessageId` of the user-role message accepted by the parent. It is not an `InboxItemId`: quiet delivery creates no inbox occurrence, while waking delivery creates one occurrence for the same stable message. It is also not a read receipt, parent-log acknowledgement, turn-completion receipt, or persistence flush.

The description states that reporting is required before finishing, repeatable, direct-parent-only, and non-terminal. It warns that a failed tool result may still follow an accepted send because a later `tools/post-execute` failure can replace the result. Without an idempotency key, stronger wording would encourage duplicate retries after ambiguous failure.

The tool uses generic rendering with no locations. Its acknowledgement includes `messageId`. Scope-local registration keeps presentation and execution aligned: roots, one-shot children, remote providers, sibling scopes, and agentless execution neither see nor execute `report`. It installs after the child's global `toolFilter`, so a delegation allow-list cannot accidentally remove the structural return channel; deployments that require no return channel omit the package.

### Service authority

The subagent seam exposes `ctx.subagents.reportFrom(child, content, { delivery, signal }): Promise<MessageId>`. The exact live child Agent is the sender credential. The continuation manager accepts only an Activation whose `handle.agent === child`, derives its direct parent from the child's durable header, and requires that id to resolve to a live parent Agent in the final synchronous authorization-and-send span. The API accepts no caller-selected recipient, ancestor, or sender fields.

Roots, one-shot children, forged objects, stale Agents, and same-id replacements fail with `UNAUTHORIZED`. A closing child Activation fails with `ACTIVATION_CLOSING`; manager drain and pre-acceptance cancellation retain their existing lifecycle errors. A missing or send-rejecting direct parent fails with `PARENT_UNAVAILABLE` and `direct parent is not live; report was not delivered`. Failure returns no id, cold-resumes no parent, writes no offline mailbox, and mutates no absent-parent Session.

Nested reporting crosses exactly one edge. A grandchild reports to its direct child parent, never to the top-level coordinator. That intermediate child may explicitly report a derived update later.

### Delivery policy

The package validates `reportDelivery: 'quiet' | 'wakeup'`; the default is `wakeup` ([why the default reversed](2026-08-06-continuable-child-report-obligation.md)).

Quiet delivery calls `parent.inject()`. It adds model-visible context without starting a parent model request: an idle parent appends before the call returns, while an admitting or running parent stages the report for the next safe log position. It creates no inbox occurrence and therefore no synthetic continuation-manager acceptance record.

Waking delivery calls `parent.followup()`. It creates one ordinary FIFO parent turn, wakes a parked parent driver, and never steers an open turn. When that parent is itself a continuable Activation, the send uses the manager's existing admission accounting so the parent cannot settle between synchronous enqueue and the admission microtask.

Both modes frame one user-role message as `Background subagent <child-id> reported:` followed by the exact `output`. The durable message source is `{ kind: 'subagent-report', senderSessionId: child.id }`. Normal Agent ordering governs concurrent sends; the subagent layer creates no second queue.

### Acknowledgement and recovery

Success means the exact live parent synchronously accepted the message. An idle quiet injection is already appended at that boundary, while staged quiet context becomes reconstructable only when it reaches its normal log boundary. Waking delivery has an inbox occurrence whose id remains separate from the returned stable message id.

The first version provides no durable mailbox, idempotency key, delivery receipt, retry protocol, or exactly-once claim. A process failure can leave the caller uncertain, and retry after an unknown outcome may duplicate a report. The durable child transcript remains the recovery source when the parent is unavailable.

### Composition and lifecycle

The subagent seam adds `registerContinuableSetup(contribution): () => void`, backed by `SubagentActivationSetupRegistry`. Each synchronous contribution receives the unpublished child context and returns the disposer for its installation. The continuation manager first applies base child composition, then current contributions in registration order through the same setup closure used for fresh creation and cold resume.

The registry owns registration, per-child installation records, setup rollback, child-scope cleanup, and immediate revocation. Applying a batch returns the Agent setup commit that revalidates provisioning after every setup await and immediately before Agent publication. A throwing or concurrently revoked contribution therefore rejects before either Agent or Session publication and rolls back the batch. New registrations affect a resident child only on its next Activation; removing a registration first closes it to new setup and then revokes every provisioning or resident installation immediately. Registration disposal and child-context disposal are idempotent and attempt every release before aggregating failures.

This seam keeps the continuation manager unaware of tool names. The report package installs only `report` and its child-scoped guidance section; `@deepseek-ai/dsh-tool-subagent-control` independently installs parent-side `send_message` and `list_agents`. A deployment can install either direction, both, or neither. Providers remain data-only, durable descriptors do not snapshot report availability or delivery mode, and cold resume uses the deployment's current contributions and policy.

### Snapshot coverage

The ACP snapshot harness adds `waitForSubagentTurnEnd`, selecting the Nth harvested child by the same order as `session.N.jsonl`. It waits for a closed child turn containing a request header so a continuable child's earlier descriptor-seed turn cannot satisfy the boundary. This lets the assembled scenario wait for the child-side report without inventing a parent-visible signal.

The authored snapshot starts a continuable child, executes the real scope-local `report` tool, observes the one ordinary parent turn the default waking delivery creates, and then submits a later parent prompt that consumes the framed report. It declares child pins `1`, so the otherwise non-global `report` schema and the child's own prompt are checked against `tool-schemas.1.expected.json` and `system-prompt.1.expected.md` while the root keeps the class pins. The generated tool catalog separately mints a child scope to include the same scope-local schema.

## Alternatives considered

### Automatically deliver every final answer

Automatic delivery cannot represent zero reports, progress reports, or several selected updates. It also couples reporting to settlement and can duplicate content already reported explicitly.

### Always wake the parent

Waking on every report creates unsolicited turns and can cascade through nested subagents. Quiet delivery was chosen as the default on the assumption that the parent had another reason to read its context. [The report obligation](2026-08-06-continuable-child-report-obligation.md) supersedes that choice: a parked background coordinator has no such reason, so waking is the default and this paragraph now records why `quiet` still exists.

### Let the child choose the delivery mode

Giving the model a mode argument grants it control over scheduler pressure and makes behavior deployment-dependent. The child chooses content and timing; deployment config chooses whether that content starts another Agent turn.

### Register a global tool

A global `report` would advertise an unusable capability to roots, one-shot children, remote children, and agentless callers. Execution-time rejection would make schema visibility disagree with authority.

### Combine both directions in the control package

`send_message` and `report` have different audiences, scopes, configuration, and lifecycle. Independent packages let deployments grant either direction without implying the other.

### Persist an offline parent mailbox

Mutating or cold-resuming an absent parent requires a new durable addressing, authorization, conflict, acknowledgement, and replay protocol. Requiring a live direct parent keeps the first version on the existing Agent send path.

### Reintroduce a Task or result promise

A result-bearing wrapper makes one report or one turn appear terminal and recreates the lifetime mismatch that continuable Activations removed. Explicit repeatable sends need no intermediate execution object.

### Validate setup after Agent creation

A post-creation revocation check can reject the Activation only after the Agent and Session have been published. Disposing the returned handle removes the live objects but cannot delete persistence through the current seam, leaving a resumable child that the continuation manager said was never established. Returning an `AgentSetupCommit` instead lets the Agent factory perform the same mutable-state check synchronously at its publication boundary.

## Consequences

- A continuable in-process child exposes exactly one scope-local `report` schema only while the report package's contribution is installed; unrelated Agents never expose it.
- The tool returns the parent message's stable `MessageId`. Quiet delivery has no `InboxItemId`; waking delivery has a separate inbox occurrence.
- Only the exact resident child may report, and only to the exact live direct parent derived from durable lineage. The service has no recipient parameter or offline fallback.
- Waking delivery is the validated default: it creates exactly one later FIFO turn and never steers an open turn. Quiet delivery never starts a parent request.
- Child cancellation or disposal after parent acceptance does not retract the report. Before acceptance, child disposal, drain, parent loss, or caller cancellation rejects the operation.
- Fresh and resumed Activations compose current setup contributions before publication. Grants wait for the next Activation; revocation is immediate for resident children.
- Unit coverage pins visibility, allow-list behavior, both delivery modes, stable message and sender identities, nested routing, invalid senders, absent parents, cancellation, drain, revocation races, and the absence of Jobs or implicit final reporting.
- The keyless assembled snapshot proves the real child tool, the one waking parent turn, durable parent framing, and later parent consumption.

### Accepted risks

The acceptance boundary is weaker than durable end-to-end delivery. A crash can leave the result ambiguous, and retries may duplicate reports.

Waking delivery can amplify model work when nested children report frequently. Deployment ownership through `reportDelivery` bounds but does not remove that risk.

Registry presence is the parent liveness signal. A host-owned parent whose `AgentHandle.dispose()` has started but has not yet unwound its scope can still accept and append a report that it will not act on in this process. Closing that gap requires an Agent-level disposal-start signal rather than subagent-layer inference.
