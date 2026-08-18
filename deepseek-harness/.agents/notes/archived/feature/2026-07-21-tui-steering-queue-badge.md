# Agent Note: TUI status line badges queued steering messages

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-tui-steering-queue-badge.zh.md)

## Problem

While a turn runs, an editor submission calls `agent.steer()` and joins the steering queue behind the running turn ([front-door Agent Note](2026-07-17-dedicated-full-screen-tui-front-door.md)). The running status line ended only with the `Enter sends steering, Esc cancels` hint, so pressing Enter gave no feedback that the message landed or how many were waiting to reach the model. A user steering several times could not tell the queue from a dropped keystroke.

## Decision

The agent's inbox is the authoritative steering queue but is not observable from the TUI, so the badge is a live count reconstructed from the public `agent/queued` and `steering/message` events rather than a projection of the queue itself.

- The running status line composes through `formatTurnStatus`, which inserts a `${queued} queued · ` badge before the `Enter sends steering, Esc cancels` hint when `queued > 0` and shows the plain hint at zero; the phase label and elapsed timing before it are the [verbose status line](2026-07-21-tui-verbose-status-line.md)'s.
- `createTuiChat` owns a `pendingSteering` counter: `+1` on each `agent/queued` for this agent whose `info.steering` is set, `-1` (floored at zero) on each `steering/message` session event as the loop drains one, and reset to zero whenever the agent leaves `running`.
- The count refreshes onto the live `Loader` through `setMessage`; the refresh is a no-op while idle because the loader exists only during a running turn.
- The reset lives in the `agent/status` transition, not in `setStatus`, because `setStatus` also runs on mid-turn palette changes and must not clear a live count.

## Alternatives considered

**Derive the count from the session log alone** (enqueued minus drained, recomputed on replay). Rejected: a cancellation clears the inbox without logging a drain, so the log cannot distinguish a drained message from a discarded one; the reset-on-non-running anchor is simpler and self-correcting each turn.

**Reset inside `setStatus`.** Rejected: `setStatus` re-runs on `applyColorScheme` mid-turn, which would wrongly zero a live count; the status transition is the only place a turn actually ends.

**Drop the decrement clamp.** Rejected: loop-authored steering (e.g. continuation reasons) logs `steering/message` with no matching user-queued increment, which would drive the count negative; the zero floor keeps the badge a lower bound rather than a lie.

**Make the wording or a threshold configurable.** Rejected: the no-hardcoded-tunables rule targets deployment-varying behavior, not brand copy; the `welcome`/hint strings are already fixed presentation.

## Consequences

- The badge is best-effort live UI state, not a logged surface: it is rebuilt from events and reset each turn, never persisted, so a resumed running turn starts its badge from zero.
- A cancellation mid-queue clears the badge cleanly through the non-running reset, and a drain past zero is a no-op — neither can strand a stale count.
- A loop continuation that keeps the agent `running` while re-enqueuing undrained late steering can transiently over-count until the next idle reset; the badge is advisory, so the window is acceptable.
- `packages/ui/tui/src/index.ts` stays at 100 % per-file coverage.

## Testing

`packages/ui/tui/tests/tui.spec.ts` drives the running status frame through the real `createTuiChat`: the plain hint at zero, a foreign-agent queue ignored, the increment to `2 queued`, a non-steering queue left untouched, the decrement as each message drains, the clamp on a drain past zero, and the reset when the turn ends. Verified live in tmux — the badge showed `3 queued` after three `agent.steer()` calls, then `1 queued` as two drained.
