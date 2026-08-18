# Agent Note: Forked children stay one-shot

Status: implemented

English | [中文](2026-08-10-fork-children-stay-one-shot.zh.md)

## Problem

Fork's only difference from spawn is that the child Session is seeded with the parent's completed-turn prefix ([subagent-fork-in-process](../../../../packages/subagent/subagent-fork-in-process/README.md)). That seed costs real tokens — the inherited history is re-sent in every child request — and its one concrete payoff is provider-side prefix reuse: under the same provider and model, a child request whose leading bytes are identical to the parent's re-prefills none of the shared span. Anything a child scope adds *ahead* of the inherited history spends that payoff, because reuse stops at the first differing byte.

The child-scoped `report` return channel is now the largest such addition, and since [the report obligation](../feature/2026-08-06-continuable-child-report-obligation.md) it is two deltas rather than one: the `report` tool schema and the `tool:report` system-prompt section. Both live in the request head — the system block and the tool block precede every message — so a continuable forked child invalidates reuse before the first inherited turn and re-prefills the whole transcript it was forked to reuse. That composition pays fork's duplication cost and collects none of its benefit, while the parent still holds a reusable prefix the child could have shared.

## Decision

Every shipped composition binds the fork delegation tool to `backgroundMode: one-shot`: [the base bundle](../../../../packages/bundle/base/cordis.patch.yml), [the ACP example](../../../../examples/acp-agent/cordis.yml), and [the headless example](../../../../examples/headless-agent/cordis.yml). The base bundle leaves `run_in_background` available, because it mounts a task service; the two examples set `enableRunInBackground: false`, because they mount none and a one-shot background start would otherwise fail at call time on a missing `tasks` service.

One-shot children — foreground and background alike — are created through `SubagentRuntime.start()`, which never enters the continuable activation-setup registry, so neither `report` nor its prompt section is installed. A forked one-shot child's system prompt and tool schemas therefore equal its parent's, apart from the `persona` and `toolFilter` deltas a deployment opts into per delegation tool.

`spawn` keeps `backgroundMode: continuable`. Continuable children and the report obligation ship unchanged for the provider whose child starts with no inherited prefix to protect, so this decision costs the report channel nothing.

### The restriction is composition, not code

`ForkInProcessProvider.prepareContinuable` stays implemented and `ctx.subagents.startContinuable()` still accepts `fork`; only the shipped `cordis.yml` rows changed. `tool-subagent` knows both the provider's `inheritsParentContext` and its own `backgroundMode` at mount, so a load-time rejection of the pair was available and is deliberately not added: the pair is not wrong in general. It is wrong only while a child-scope delta precedes inherited history, and the package that creates that delta — [`dsh-tool-subagent-report`](../../../../packages/subagent/tool-subagent-report/README.md) — is separately installable and, by its own design, invisible to `tool-subagent`. A deployment that omits the report package can run continuable forked children with the prefix intact. Encoding one roster's consequence as a delegation-tool invariant would make the tool assert something it cannot observe.

The reintroduction condition is recorded as a `TODO(fork-continuable-prefix-reuse)` marker on `prepareContinuable` itself, the one method the shipped compositions do not call, and tracked as issue #2124: continuable fork reopens when a child's system prompt and tool schemas can match its parent's byte for byte.

## Alternatives considered

**Reject `inheritsParentContext` + `continuable` at mount.** A loud load-time failure would prevent silent reintroduction, which is what the configuration change cannot do. Rejected because the delegation tool cannot see the report package and the combination is legitimate without it; the invariant would be false for a deployment that never installs a child-scope delta, and `tool-subagent` would be asserting a fact owned by the roster.

**Stop mounting the fork provider at all.** This was the broader form of the restriction. Rejected because foreground fork *is* the prefix-reusing case and is untouched by the report channel, so a full ban gives up the capability without buying anything the one-shot binding does not already buy — and would leave no shipped composition exercising session seeding.

**Ship continuable forked children and accept the loss.** Rejected because the loss is total rather than marginal: reuse breaks ahead of the inherited history, so the child pays full prefill on a transcript it duplicated for the sole purpose of not paying it. A deployment that wants a long-lived child with no inherited context already has `spawn`.

**Make `report` visible to every Agent.** A global registration would restore byte-identical prefixes by giving parent and child the same schema and section. Rejected because roots, one-shot children, remote children, and agentless callers would advertise a tool with no derivable recipient, and execution-time rejection would make schema visibility disagree with authority — the scope-local decision the [report tool Agent Note](../feature/2026-07-30-continuable-subagent-report-tool.md) already settled.

**Install the child-scope deltas after the inherited history.** Rejected as unrepresentable: the system prompt and the tool schemas are request-head structures in every provider's wire format, so no ordering within them can place a child-only addition behind the message list.

## Consequences

- No shipped composition creates a continuable forked child; `subagent_fork` returns a result to its caller's turn, and `send_message` addresses only spawned children.
- A forked child's request prefix stays byte-identical to its parent's unless the deployment configures `persona` or `toolFilter` on the fork delegation tool, so the token cost of seeding buys provider-side reuse again.
- The fork provider's continuable path has no production caller and no assembled-composition coverage. It keeps its package-level tests, and the seam still accepts it, so a bundle or `--patch` overlay can reintroduce it with no code change and no warning.
- `subagent_fork`'s model-visible schema changes: the continuable background wording is replaced by the one-shot task wording in the base bundle, and disappears entirely from the two examples. The affected keyless snapshot tool-schema sidecars are re-recorded in the same change.
- The report obligation's reach narrows to spawned children in shipped deployments. Its default `wakeup` scheduling, authority model, and coverage are unchanged.

### Accepted risks

The constraint lives in three configuration files and a code comment, not in a gate. A future bundle row or profile patch can set `backgroundMode: continuable` on a fork tool and silently reintroduce the prefix loss; nothing fails loud. That is the accepted cost of not encoding one roster's consequence into `tool-subagent`.
