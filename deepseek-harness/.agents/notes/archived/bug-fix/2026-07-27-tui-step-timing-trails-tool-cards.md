# Agent Note: TUI step timing trails the step's last message

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-27-tui-step-timing-trails-tool-cards.zh.md)

## Problem

The per-step timing summary (`Model wait … · Completed …`) was a child of the assistant message component, so it rendered directly under the assistant text. When a step drove tool calls, the tool cards were appended to the chat *after* the assistant message, leaving the timing line stranded above them — one message before the step's actual last output. The summary is meant to close a step, so on any tool-calling step it appeared in the wrong place.

## Decision

The timing summary is its own `StepTimingComponent`, no longer a child of `AssistantMessageComponent`. `StreamingAssistantComponent` owns one and exposes it as `timing`, but the renderer attaches it to the chat as a sibling that follows the assistant message. Whenever a `tool/call` or `tool/result` of the open step appends a card, `trailStreamingTiming()` moves the footer back to the tail of the chat, so it always trails the step's last message. On `step/end` the footer is completed in place — already at the tail — and stays pinned while the next step's output follows. `removeStreaming` and the reasoning-toggle rebuild detach and reattach the footer together with its streaming component.

Event ordering makes this exact: within a step the loop appends `tool/call` and `tool/result` before `step/end`, so the footer is repositioned while `streaming` is still set, then frozen when the step ends.

## Alternatives considered

**Keep the timing inside the assistant message and reorder tool cards above it.** Rejected: tool cards belong after the assistant text that requested them; moving them above the assistant message to sit under the timing would misrepresent the transcript order.

**Recompute a single trailing footer for the whole turn instead of one per step.** Rejected: a multi-step turn shows each step's own completed timing, and collapsing them would drop the per-step buckets the existing timing tests pin.

**Reposition the footer from a `step/end`-only handler.** Rejected: tool cards render before `step/end`, so a footer moved only at step end would already be trailing but would not track a mid-step re-render, and the running (pre-completion) footer would still sit above the tool cards during streaming.

## Consequences

- On a tool-calling step the timing summary renders below the tool cards, both while the turn runs and after it completes; the package snapshots (`untrusted-controls`, `cordis-tools-pending`, `advanced-cards-*`, `code-mode-pending`, `dynamic-workflow-pending`, `surface-before-compaction`) and the example transcripts (`todo-plan`, `bash-terminal-card`, `code-mode`, `parallel-file-reads`, `dynamic-workflow`, `cordis-dynamic-toolchain`, `code-mode-dispatch-spill`) pin the new order.
- A unit test asserts the completed timing appears after a step's tool output; it fails on the pre-fix ordering.
