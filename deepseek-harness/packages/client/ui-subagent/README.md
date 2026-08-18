# @deepseek-ai/dsh-client-ui-subagent

English | [中文](README.zh.md)

Web subagent feature owner: contributes the lazily expandable catalog tree to `conversation.session.header.actions`, reason-specific read-only replacements to the conversation composer chain, and the existing `@` reference source to `ctx.inputTriggers`.

The header action reads `subagentsByParent` and session summaries through the standard `useSessions` hook. After a non-empty direct catalog arrives, its trigger counts the complete subagent-only descendant lineage, stops at ordinary forks, and shows ongoing activity when any counted descendant is running. The compact tree remains direct-catalog authoritative: continuable and one-shot rows display mode plus `running`/`inactive` activity and an optional log-backed title, while the trailing column stacks total durable provider usage above active-turn duration. Token totals sum the four disjoint `tokenUsage` buckets. Visual duration stays exact to the second below one day, then uses at most two adjacent units—days/hours, approximate months/days, or approximate years/months—while hover and the accessible name retain the exact day/hour/minute/second value. Duration sums completed `subagentTiming` turns, advances once per second only for an open turn on a running child, and freezes after the child becomes inactive; an interrupted open turn is bounded by its same-cut `active.through`, never by newer session metadata. An unlabeled one-shot row falls back to its session id, while corrupt, unsupported, or unavailable rows remain readable but disabled. Each healthy row's `hasChildren` hint determines disclosure before interaction, so known leaves never show an arrow; a catalog level reserves the disclosure column only when at least one healthy row is a branch, allowing branchless levels to start at the leading status marker. Expanding a branch immediately reserves one disabled loading row per known direct descendant, then lazily replaces them with that child's authoritative catalog. Every visible branch is reported to the runtime so membership frames cause a debounced refresh only where the tree is being consumed. Selecting any depth calls `SessionRuntime.openSubagent()` with the row's exact `{parentSessionId, childSessionId, mode}` address. Component-local state owns tree visibility, expanded branches, keyboard focus, and the running-duration clock. ArrowRight/ArrowLeft expand and collapse branches; ArrowUp/ArrowDown, Home, End, and Escape navigate or close the tree; closing returns focus to the trigger. Styling uses tokens only.

A one-shot child always elects a read-only composer that identifies the transcript as a completed execution record. A continuable child does so only when its exact parent is unavailable and the child is not running, with copy explaining the recovery path; while such a child still runs, the selector yields to the ordinary composer, whose input and Send action are disabled but whose independent Stop stays usable, and the takeover returns once it stops. A continuable child with a live parent keeps the ordinary input chrome, whose Session routes prompts through `subagent.prompt`: typing and Send stay available while the child runs because every follow-up joins the child's FIFO inbox, while an independent Stop routes through `subagent.interrupt`. This package never receives host context or calls a model-facing tool. The catalog and composer behavior are specified by the [Web subagent conversations Agent Note](../../../.agents/notes/implemented/feature/2026-07-27-web-subagent-conversations.md) and the [current-turn interrupt Agent Note](../../../.agents/notes/implemented/feature/2026-08-06-continuable-subagent-interrupt.md).

Subagent-origin Session rows are omitted from the ordinary sidebar, so the parent header catalog is their navigation entry point. Ordinary forks remain in the sidebar.

The `@` source remains deliberately separate and inert. Candidates are zero-RPC running children from `ctx.sessions.list`; picking one inserts literal `@label ` text, and the codec projects `@label`. It has no command-adjudication hooks and does not resolve labels into continuation addresses.

## Model Experience

### Subagent label text in the user prompt

#### What the model sees

Only the legacy `@` reference source affects model input: a picked candidate reaches the ordinary user message as literal `@label`, without a dedicated block or host-side resolution. Catalog browsing, child navigation, and persisted transcript viewing add no prompt section; accepted continuation content becomes a normal FIFO user message through the host subagent adapter.

#### Token effect

Conditional and append-only: the literal `@label` or a human follow-up adds tokens only to its new user message. Catalog and transcript operations add zero model tokens.

#### KV Cache effect

Append-only. This package never edits earlier request tokens.

## Known Limitations and Deferred Work

- **The catalog has no durable outcome** — activity and timing do not distinguish completion, failure, or cancellation, and the UI exposes no Activation identity; stopping is limited to the composer's current-turn Stop for a running continuable child.
- **`@` references remain display-title text** — duplicate or renamed labels are ambiguous, so they intentionally do not acquire continuation semantics.
