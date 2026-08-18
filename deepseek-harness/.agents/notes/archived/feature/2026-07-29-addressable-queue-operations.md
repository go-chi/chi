# Agent Note: Address pending queue occurrences for edit and removal

Status: implemented
Archived: 2026-07-31

English | [中文](2026-07-29-addressable-queue-operations.zh.md)

## Problem

The Web queue rendered pending messages but could not edit or delete one row. `MessageId` was insufficient as an address because callers may enqueue the same immutable message more than once. The browser also inferred queue retirement from turn and status events, so a row operation racing with driver claim had no authoritative outcome.

## Decision

**Each accepted FIFO occurrence has its own identity.** AgentLoop mints an opaque `InboxItemId` and publishes an `InboxItem` containing that id, the identified `UserMessage`, and its acceptance-time `queued | steering` placement. Reusing one `MessageId` creates distinct inbox identities. Injection bypasses the FIFOs and receives no inbox identity.

**Mutation ends at driver claim.** `Agent.updateInbox(id, action)` synchronously searches the pending queued FIFO. Edit replaces frozen content while preserving `InboxItemId`, `MessageId`, source, wake policy, and position. Remove emits the occurrence’s terminal discard. Steering and driver-claimed occurrences return `not-found`, so queue operations never rewrite active-turn input or durable history.

**The live ledger is authoritative.** `agent/inbox/enqueue`, `update`, `dequeue`, and `discard` maintain a Host mirror of queued occurrences. A synchronously re-entrant update or terminal event may reach the mirror before its outer enqueue listener; the mirror retains that unseen outcome for the current dispatch and folds it into the enqueue, so listener registration order cannot publish stale content or a ghost row. The wire sends complete `session/queue` snapshots rather than incremental guesses. Reconnect sends the current baseline, and every queued mutation or terminal event replaces it. The client applies no optimistic edit and never retires a row from durable turn events or status changes.

**Queue addresses require a live Agent.** `session.updateQueue` queries only the mounted Agent registry and never resumes a cold session: an `InboxItemId` is process-local and cannot name work after restart or disposal. A missing Agent and a driver-claimed occurrence both return `queue-item-not-found`.

**Web actions address Queue only.** The Host excludes pending steering from `session/queue`; steering retains its existing durable transcript path after consumption. QueueDock hides while empty, renders one pending occurrence directly, and defaults two or more occurrences to a collapsed `"<n> 条排队消息"` header that expands or collapses the complete list. The header exposes `aria-expanded` and `aria-controls`; the expanded list scrolls within a 180px height bound. An active edit or mutation keeps its rows visible, and emptying the queue restores the collapsed default for the next queue. Visible rows expose edit and delete, but no send-now control. The UI derives queue row and mutation types from the runtime `SessionFace` contract rather than importing the connection plugin, so plugin cooperation continues through services and snapshots. Edit is available only when all content blocks are text; the editor cannot silently drop non-text blocks. An editing row exposes only save and cancel, with Enter and Escape as their keyboard equivalents. Delete removes the exact occurrence.

## Alternatives considered

**Address rows by `MessageId`.** Rejected because one immutable message may be sent repeatedly; editing or deleting by message identity would affect an ambiguous occurrence.

**Apply optimistic browser mutations.** Rejected because driver claim and another client can win before the Host action. Waiting for the authoritative snapshot makes the ownership boundary visible and lets `queue-item-not-found` report a real race.

**Include pending steering in the queue mutation protocol.** Rejected because QueueDock has no steering interaction, and editing or deleting active-turn input would widen this feature beyond its current consumer. A dedicated steering interaction owns that delivery contract.

**Expose a protocol-only promotion operation.** Rejected because no product interaction reorders Queue. A public operation without a current consumer would add ordering semantics and tests for speculative use.

**Resume a cold Agent for a queue operation.** Rejected because durable session identity does not preserve the process-local inbox capability. Resuming can only produce `not-found` after creating unrelated live state.

## Verification

AgentLoop contract tests hold prompt admission while editing and removing exact queued occurrences, reject mutations of steering occurrences, and verify the resulting independent turn and terminal lifecycle events. Host schema and proxy tests cover queued-only authoritative snapshots, synchronous re-entrant mutation order, reconnect, cold-Agent rejection, typed not-found errors, and the RPC transport. Client runtime and QueueDock tests cover non-optimistic projection, single-row presentation, default multi-row collapse, interaction-forced visibility, reset after emptying, expansion, text-only editing, save and cancel affordances, removal, retirement races, and disabled mixed-content editing. Keyless browser scenarios capture the default collapsed header before expanding the queue and driving its exposed edit and delete actions through the built Web composition and real HTTP/SSE wire.

## Consequences

Queued work gains precise row operations without becoming durable session history. Occurrence identity is a live process-local capability and disappears at claim, cancellation, disposal, or restart; reconnect recovers only queued items still held by the live Agent. Editing excludes mixed content until an editor can preserve every block, while pending steering remains outside this operation surface.

The protocol now carries full queue snapshots on each change. Queues are expected to remain short, so deterministic recovery and multi-client convergence are preferred over an incremental mutation protocol.
