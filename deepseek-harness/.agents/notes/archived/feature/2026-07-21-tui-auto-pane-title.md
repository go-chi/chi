# Agent Note: Auto-titled terminal from the first message

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-tui-auto-pane-title.zh.md)

> **Superseded** by the [session-title consolidation Agent Note](../simplification/2026-07-22-tui-titles-from-session-title-service.md): the TUI-local `autoTitle` generation is removed; titles come from the log-backed session-title service, and the terminal rename consumes `session/title` events.

> **Superseded** for the default and the resume behavior by the [auto-title default-on Agent Note](2026-07-21-tui-auto-title-default-on.md): `autoTitle` now defaults on, and a resumed session re-derives its title from the stored first message instead of keeping the static one. The OSC 0 path, the one-shot latch, the model-summary shape, the fire-and-forget call, and every failure fallback below stand.

## Problem

The TUI's terminal title is a single static string (`title`, default `DeepSeek Harness`) shared by every session. A user who runs one agent per tmux pane or terminal tab sees the same label on all of them, so panes are indistinguishable at a glance and the tab bar carries no signal about what each session is doing.

## Decision

- `TuiConfig` gains an `autoTitle` boolean (default `false`). When it is on, the TUI issues one background model call after the first user message of a fresh session and replaces the terminal title with a short, model-generated label; the static `title` is the pre-title and the fallback.
- The label is a model summary, not a truncation of the prompt. The request carries a fixed task instruction (summarize the request as a short title of two to five lowercase words, no punctuation) plus the user's first message and no tools; the TUI takes the first non-empty line of the reply and caps it at 40 characters (39 plus an ellipsis).
- The title is set through `runtime.terminal.setTitle`, the same OSC 0 path the static `title` already uses. No new terminal-control surface is introduced, and pi-tui keeps ownership of terminal writes.
- The call is fire-and-forget and one-shot per session. A `titleSettled` latch guards it: with `autoTitle` off it is pre-settled and never runs; on a resumed session whose first `user/message` is already logged it is pre-settled so the static title stands; a whitespace-only first message is skipped without consuming the slot. Any failure, an empty reply, a missing `llm` service, or a missing agent provider/model leaves the static title untouched. A dedicated `AbortController` cancels an in-flight request on shutdown.
- The title call reaches `ctx.llm.stream` directly rather than through `agent.send`, so it never appends to the session or transcript and cannot perturb the agent loop.
- The feature defaults off and is enabled only in the interactive product config (`examples/tui-agent/cordis.yml`) and the scripted PTY fixture. Enabling it in the shared `dsh-tui-demo` schema default would fire an extra model call in keyless replay and boot scenarios that send no user message.

## Alternatives considered

**Truncate the first user message instead of a model title.** Rejected: the user chose a short model-made label; a truncated raw prompt is noisy, often begins with boilerplate, and rarely reads as a title.

**Rename the window (OSC 2) or the tmux window.** Rejected: OSC 0 sets only `pane_title`, so it labels the pane without renaming or leaking into the user's window title; the user confirmed OSC is the right lever.

**Default the feature on.** Rejected: enabling it in the shared demo schema perturbs keyless replay and boot snapshots and spends a model call on every fresh session; opt-in per deployment keeps the default surface inert.

**Fold this into the log-backed session-title work (PR #451).** Rejected: that change is session metadata persisted to the log; this is a terminal label with no persistence. Keeping them independent leaves each self-contained and avoids a shared dependency.

**Block the first turn until the title resolves.** Rejected: awaiting the title before sending the user's message adds latency to the actual request; fire-and-forget makes the rename invisible to the turn.

## Consequences

- When enabled, a fresh session spends one extra, tool-less model call with a single short user message and a few output tokens; off by default, it costs nothing.
- Because the title call stamps `sessionId`, it shares the session's `llm-replay` cursor: enabling `autoTitle` in a replay-backed snapshot scenario would consume a recorded script entry. This is why the default is off and the scripted PTY fixture answers the call with a tool-branching adapter rather than replay.
- `packages/ui/tui/tests/tui.spec.ts` pins the behavior with a mock `llm` adapter: a generated title replaces the static one, over-long output is truncated with an ellipsis, a whitespace-only first message keeps the one-shot slot, empty or failing replies leave the title, a resumed session never fires, and the feature-off / no-service / missing-provider / missing-model paths keep the static title. A shutdown test asserts the in-flight request is aborted.
- `examples/tui-agent/tests/tui-keyless-smoke.e2e.ts` proves the real Loader-booted path: the scripted adapter answers the tool-less title call with a fixed string, and the conversation scenario asserts the OSC 0 sequence reaches the PTY. Boot scenarios send no user message, so they never fire the call.
