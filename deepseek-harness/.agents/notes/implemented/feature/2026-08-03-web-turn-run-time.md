# Agent Note: Web turn run time and hover-revealed time chrome

Status: implemented

English | [中文](2026-08-03-web-turn-run-time.zh.md)

## Problem

The Web chat shows when a message arrived but not how long the agent worked on it. Long turns give no live progress signal beyond the static activity label, and after the turn settles the wall time is not recoverable from the UI. Meanwhile the always-visible clock row adds visual noise to every message.

## Decision

Turn wall time uses the existing logged `turn/start` and `turn/end` timestamps, with no new session events. The client Session folds each in-window pair into `turnTimings`; the actions-owning assistant footer renders `endTime - startTime` as a localized `Ran for {duration}` label after the turn ends. The running `TurnStatus` clock uses the latest timing without an end, so reload preserves elapsed time, steering does not reset it, and a retry starts from its own logged boundary. Both readings use the same localized formatter and whole-second floor. The clock appears only after 15 seconds and is hidden from the live region so screen readers announce the activity status without replaying every tick.

Time chrome (clock and run time) is hover-revealed: message containers opt in with a `data-time-hover-root` attribute, and `MessageIconActions.module.css` fades the time label in on container `:hover`/`:focus-within`. The rule is scoped to `@media (hover: hover)`, so touch devices keep the always-visible label; opacity (not display) keeps the layout stable. Copy/branch icons stay always visible.

## Alternatives considered

**Deriving timing from message nodes.** The nearest user or steering timestamp is available in the rendered transcript, but it mismeasures retry turns and lets mid-turn steering reset the live clock. Existing turn boundary events provide the authoritative timestamps without changing the log format.

**Anchoring the live clock to component mount.** Simpler, but a mid-turn reload would restart the clock at zero and disagree with the eventual footer label. Mount time remains only the fallback when `turn/start` is outside the loaded window.

**Hiding the whole actions row until hover.** Copy and branch are affordances worth discovering, and row-level show/hide risks layout shift. Only the passive time text is hover-gated.

## Consequences

Turn duration is visible live and after settlement without new session events, and both readings share exact log boundaries and formatting. The settled duration includes activity after the last assistant text up to `turn/end`; the label is absent when `turn/start` is outside the loaded window. Time chrome no longer competes with message content at rest, and the ticking clock remains visual rather than repeatedly announced.
