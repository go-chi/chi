# @deepseek-ai/dsh-tool-subagent-report

English | [中文](README.zh.md)

The optional child-scoped `report` tool is a thin adapter over `ctx.subagents.reportFrom()`. It gives every continuable in-process child a return channel to the Agent that started it, and installs the prompt section that instructs the child to use it. The package registers a continuable-child setup contribution instead of a global tool, so the tool and its guidance exist only inside those children. Roots, one-shot subagents, remote subagent providers, sibling scopes, and agentless tool execution never present or execute it. Installing this package grants only that child-scoped capability; the parent-to-child direction remains the independent [`@deepseek-ai/dsh-tool-subagent-control`](../tool-subagent-control/README.md), and continuable mode depends on neither package.

The child-scoped `tool:report` prompt section instructs the child to call `report` once before finishing, with a self-contained answer, and earlier whenever a partial finding changes what the parent should do next. The instruction is guidance, not enforcement: the mechanism still accepts zero or many calls in one turn, and no runtime path rejects a child that never reports. A successful call neither concludes the turn, settles the Activation, nor prevents later parent follow-ups, and finishing a turn never reports automatically. The tool accepts no recipient: `exec.agent` is the sender's exact live Agent and the authority credential, and the service derives the sole recipient from that child's durable `parentSession`. Success returns the stable `MessageId` of the parent-accepted message, not a read receipt, an inbox-occurrence id, a parent-log acknowledgement, a turn-completion receipt, or a persistence flush. A parent absent from the registry fails the call with `direct parent is not live; report was not delivered` — registry presence governs parent resolution, and a registered parent already in host-owned disposal still accepts while its log admits appends. The service performs no injection, parent cold resume, or offline mailbox write; the durable child transcript remains the recovery source, and a failed tool call does not prove non-delivery (a later `tools/post-execute` veto can fail a call whose report was already accepted).

`reportDelivery` selects parent scheduling for every accepted report. `wakeup` (the default) uses `parent.followup()`, creating exactly one ordinary later parent turn and waking a parked parent driver; it never steers an open turn. It is the default because a parent that already parked has no other reason to look, so quiet delivery would leave an accepted report unread until something unrelated woke it. `quiet` uses `parent.inject()`, adding model-facing context without starting a parent model request: an idle parent's append completes before the call returns, while a report reaching an admitting or running parent stages for the next safe log position. This is deployment scheduling policy, so the model-facing schema cannot select or override it per call.

Scope-local registration deliberately survives the child's global `toolFilter`, so a delegation allow-list cannot remove the only return channel. A deployment that requires a child with no return channel omits this package.

The contribution body is exported as `installReportTool(childCtx, ctx, delivery)` so inspection consumers can install `report` and its guidance into a minted child scope, and returns the one disposer revoking both. The generated tool catalog uses that path because the global registry cannot expose a scope-local schema. Production composition still enters through `apply()`; the subagent seam's contribution registry remains private.

## Model Experience

### Tool schema

#### What the model sees

The generated [`report` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-subagent-report): one required `output` string. Its description states that the child must report once before finishing, that reporting reaches only the Agent that started the child, and that it does not end the turn. It carries no recipient or delivery-mode parameter. The separate `tool:report` prompt section repeats the obligation outside the schema, where a child that ignores tool descriptions still reads it.

#### Token effect

Fixed schema and prompt-section cost per continuable-child request, and none in any other Agent's requests.

#### KV Cache effect

Prefix-stable within a child; neither the schema nor the section changes at runtime. Removing the package revokes both from resident children, which changes their next request prefix.

### Report result

#### What the model sees

`report accepted by the agent that started you as message <messageId>` on acceptance; the canonical output carries the stable `messageId`. A failure from an unauthorized sender, an unavailable parent, or a closing lifecycle is an errored result. The description says a failed call may still have arrived because a later `tools/post-execute` failure can replace the result after `reportFrom()` accepted the message.

#### Token effect

One short acknowledgement per call in the reporting child. The reported content is additionally billed to the parent: waking delivery makes it the sole ordinary message of one new parent turn, while quiet delivery adds it to the parent's next request.

#### KV Cache effect

Append-only in the child. In the parent, the framed report follows existing history and preserves the reusable prefix.

### Parent-visible report

#### What the model sees

One user-role parent message framed as `Background subagent <child-id> reported:` followed by the child's exact `output`, with a durable source `{ kind: 'subagent-report', senderSessionId: <child-id> }` that names the child.

#### Token effect

The child's complete `output` plus the one-line frame, uncapped by this package.

#### KV Cache effect

Append-only; the report follows the parent's reusable request prefix. Waking delivery starts an independent parent model request, while quiet delivery does not.

## Known Limitations and Deferred Work

- **A parent whose host-owned disposal already started can still accept** — `AgentHandle.dispose()` cancels, awaits quiescence, and only then unwinds the scope and leaves the registry; it exposes no signal for "disposal started." A report accepted in that window is appended to the parent's transcript, but that parent will not act on it in this process. A continuation-manager-owned parent rejects forest teardown through the manager's admission boundary.
- **Acceptance is weaker than durable delivery** — there is no durable mailbox, idempotency key, delivery receipt, retry protocol, or exactly-once claim. A process failure after one side recorded acceptance leaves the outcome ambiguous, and an external retry may duplicate the report.
- **A staged quiet report is not immediately reconstructable** — acceptance returns its stable `MessageId`, but the parent Session reconstructs the framed content only after pending context reaches its ordinary log boundary.
- **Granting waits for the next Activation; revocation is immediate** — installing this package after a child becomes resident grants `report` and its guidance only on that child's next Activation, while removing the package revokes both from resident children immediately.
- **Nested reporting reaches exactly one edge upward** — a grandchild reports to its direct child parent, never to the top-level coordinator, which must explicitly report a derived update later.
- **No rate limiting** — the default `wakeup` mode can amplify model work when nested children report frequently; a deployment that accepts unread reports over that amplification selects `quiet`.
