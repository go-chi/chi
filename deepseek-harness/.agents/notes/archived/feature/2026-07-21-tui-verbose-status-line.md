# Agent Note: The running status line shows the turn phase and elapsed time

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-tui-verbose-status-line.zh.md)

## Problem

While a turn ran, the [full-screen TUI](2026-07-17-dedicated-full-screen-tui-front-door.md) showed a single static "Working" spinner. It conveyed neither how long the current step had taken nor what the agent was doing — waiting on the model, thinking, streaming a response, or running tools — so a slow or stalled turn was indistinguishable from a fast one.

## Decision

- While a turn runs, the status line above the editor shows a derived phase label with elapsed time, keeping the trailing `— Enter sends steering, Esc cancels` hint. The four phases and their labels are `waiting` → "Waiting for the first token", `thinking` → "Thinking", `responding` → "Responding", and `executing` → "Executing tools".
- The phase is presentation state the TUI derives from live session events, not a session event or agent status of its own. `step/start` enters `waiting`; an `assistant/chunk` reasoning delta or reasoning block-start enters `thinking`; a text delta or text block-start enters `responding`; a `tool/call` enters `executing`. The event map is merge-extensible, so every other event kind falls through a default and leaves the phase unchanged.
- The label reports two clocks — `<phase> <phase-elapsed> · total <step-elapsed>` — except `waiting`, which shows only the step total. The phase clock resets on a genuine phase change or a new step; the step clock resets on `step/start`. Durations format as `8s` below a minute and `1m05s` at or above one. Tool time between `step/end` and the next `step/start` accrues to the finishing step's total.
- A single `RunningStatus` controller — the loader, the phase, the two baselines, and a refresh timer — exists only while a turn runs. A one-second `setInterval` refreshes the elapsed time; a phase event refreshes it immediately. `clearStatus` clears the interval, stops the loader, and drops the controller, so any transition to idle or disposed leaves no live timer, matching the [borderless banner](2026-07-21-tui-borderless-banner.md)'s timer hygiene. A mid-turn palette rebuild (`setStatus` re-derives the editor border on a terminal color-scheme change) carries the phase and both baselines across, so a running status never snaps back to `waiting`.

## Alternatives considered

**Emit the phase as a session event or agent status.** Rejected: the phase is a presentation detail the TUI reconstructs from events already logged. A durable, model-visible phase would demand a new session event under the model-visible ⟺ logged rule, for no model benefit.

**Reuse pi-tui's `Loader` animation timer to refresh the elapsed text.** Not available: the vendored `Loader` animates only its spinner glyph, and its dist is not ours to change. The TUI owns a separate one-second interval, cleared on teardown.

**Infer the phase from tool-drain or streaming-component state.** Rejected: the `step/start`, `assistant/chunk`, and `tool/call` lifecycle events are cleaner signals, already handled in the same live listener, and avoid coupling the status line to other components.

**Show only elapsed time, or only the phase.** Rejected: both are wanted — the per-phase time answers what the agent is doing, the per-step total answers how long the step has taken.

## Consequences

- The status line reads, for example, `Thinking 4s · total 8s — Enter sends steering, Esc cancels`, so the agent's current activity and step duration are legible and a stall is visible.
- Phase detection is best-effort presentation: an unhandled future chunk or event kind leaves the last phase in place and never throws.
- Exactly one `setInterval` runs per active turn, cleared with the controller on every idle or disposed transition and on shutdown.

## Testing

`packages/ui/tui/tests/tui.spec.ts` pins each phase label against its triggering event (`step/start`, reasoning and text deltas and block-starts, `tool/call`), that a new step reopens the wait window, that the elapsed time advances on the controller's own timer past one second, that a step beyond a minute renders `1m…`, that a mid-turn color-scheme change preserves the phase and elapsed time, and that a live event arriving before the turn runs moves no status. Verified live in tmux.
