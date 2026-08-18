# Agent Note: Persist assembled assistant messages, not stream chunks

Status: rejected — high-fidelity chunk replay, partial failed streams, and snapshot replay currently depend on persisted `assistant/chunk` events. Dropping chunks is only viable with a no-information-loss replay/artifact replacement.

English | [中文](2026-06-20-assembled-assistant-messages-only.zh.md)

## Problem

The canonical session log currently persists every `assistant/chunk` exactly as streamed by the model. The [session persistence Agent Note](../../implemented/architecture/2026-06-14-session-persistence.md) chose this for token-level replay fidelity and contiguous `seq`, but the cost has grown: JSONL fixtures are dominated by tiny delta records, snapshot scenarios replay the model by grouping chunk events, ACP load reconstructs prior assistant output from chunks, and any future log reader must distinguish durable message history from token-level trace.

For successful steps that assemble completed content, the loop already appends an `assistant/message`. That is the event `deriveMessages()` uses for the next model request. In other words, the normal resumable conversation state is already present without the chunks; chunks are a live rendering and deterministic-test artifact, not required conversation history. Failed or aborted streams are different: partial assistant output may exist only as chunks, and empty max-token steps may produce no `assistant/message` at all.

## Proposal

Stop storing `assistant/chunk` in the canonical session log. The durable log keeps `assistant/message`, `tool/call`, `tool/result`, `usage` if retained, and turn boundaries. Live UIs can still receive token deltas through a deliberately transient stream event. Snapshot replay should move its model script into an explicit fixture sidecar or derive it from a recorded adapter artifact, rather than treating the canonical user session as a token tape. Scenarios that need partial failed-stream output must record that output in the replay fixture.

ACP `session/load` can replay prior assistant messages as complete content blocks instead of simulating the original token stream. A loaded transcript need not reproduce every historical delta; it must show the same completed assistant content and resume with a valid provider history.

## Acceptance criteria

- `SessionEventMap` drops `assistant/chunk`, or marks it as non-persisted if a transitional live event is needed.
- [Session persistence docs](../../../../packages/session/session-persistence/README.md) no longer require every stream chunk to be stored verbatim.
- `llm-replay` and ACP snapshots use an explicit replay fixture format or sidecar for model chunks.
- `session/load` renders completed assistant messages from `assistant/message`.
- Stored logs get much smaller and remain `seq`-contiguous without chunk holes.
- The session format version and recorded fixtures are refreshed; non-current stored logs are rejected per the pre-release format policy.

## What we give up

The canonical user session no longer reconstructs the exact token stream of an old turn. It also loses partial assistant output from failed or aborted streams unless another event or fixture records it. That is too much information loss for the current resume, load, and snapshot contracts. Tests that need exact deterministic streams should own that fixture directly only if the production session log keeps enough fidelity for user-visible recovery.

## Related

This supersedes the chunk-persistence choice in [session persistence](../../implemented/architecture/2026-06-14-session-persistence.md) and affects [ACP snapshot tests](../../implemented/testing/2026-06-19-acp-snapshot-tests.md), whose current replay plugin derives its script from `assistant/chunk` events.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
