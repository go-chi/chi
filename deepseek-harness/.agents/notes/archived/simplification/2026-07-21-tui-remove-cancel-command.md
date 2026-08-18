# Agent Note: Drop the TUI `/cancel` slash command

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-tui-remove-cancel-command.zh.md)

## Problem

The TUI exposed two identical ways to cancel a running turn: the `Esc` (and `Ctrl+C`) keybinding and a `/cancel` slash command. Both called `agent.cancel('cancelled from terminal')` with the same reason; when idle, `/cancel` only printed a "The agent is already idle." notice while the keybindings stayed silent. The running status line already advertises the keybinding (`Enter sends steering, Esc cancels`), and cancelling by keystroke needs no editor submission, so the slash command was a second, less discoverable path to the same effect — surface area with no behavior of its own.

## Decision

`/cancel` is removed. Cancelling a running turn is a keybinding-only affordance (`Esc`, or `Ctrl+C` while running), which the status-line hint and the `/help` shortcut list already document. The `baseCommands` autocomplete entry, the `/help` command line, the `case '/cancel'` branch in the editor submit handler, and the "already idle" notice it owned are gone; every other slash command (`/help`, `/clear`, `/reasoning`, `/tools`, `/redraw`, `/reload`, `/resume`, `/exit`, `/skill:<name>`) is unchanged. Typing `/cancel` now falls through to the generic `Unknown command:` warning like any other unrecognized slash input.

## Alternatives considered

**Keep `/cancel` as a discoverability alias** — rejected: the running status line and `/help` both name `Esc`, so a typed alias adds a maintained code path and a per-idle-state notice for an action a single keystroke already performs more directly. No consumer needed the editor-submission route to cancellation.

## Testing

`packages/ui/tui/tests/tui.spec.ts` asserts `agent.cancelled` contains `'cancelled from terminal'`, driven by the `Esc`/`Ctrl+C` keystrokes in that turn — the sole cancel affordance. The `errors-and-help` and `disposed-terminal` snapshots pin the `/help` line without `/cancel`; per-file coverage on `packages/ui/tui/src` stays at 100%.

## Consequences

There is no way to cancel a turn by editor submission; cancellation is keybinding-only. This is a net removal of a redundant path and its idle-state notice, matching the single-primitive shape the rest of the stop surface already follows ([public stop surface](2026-06-20-public-agent-stop-surface.md)). Restoring a typed cancel would return with the autocomplete entry, the submit-handler branch, and its own test.
