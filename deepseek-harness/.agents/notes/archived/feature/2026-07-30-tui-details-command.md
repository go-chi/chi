# Agent Note: /details command for transcript detail state

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-30-tui-details-command.zh.md)

## Problem

The TUI's transcript detail state — tool-card visibility (`collapsed`/`expanded`/`hidden`, per the [consolidated TUI presentation](../architecture/2026-07-28-consolidated-tui-presentation.md)) and reasoning-block display — was reachable only through the Ctrl+O cycle and the Ctrl+R toggle. A user who wants a specific mode must cycle through the others, cannot set both dimensions in one action, and has no way to query the current state; a terminal that swallows those control keys has no fallback at all.

## Decision

`dsh-tui` registers `/details` beside its other agent-scoped commands. Bare `/details` opens `DetailsDialog`, a centered keyboard toggle with one entry per dimension — `Tool cards` and `Reasoning` — showing the live values: Tab cycles the highlighted entry and applies the change immediately, so the transcript behind the dialog is the preview, and Enter, Esc, or Ctrl+C closes; its width is the `detailsDialogWidth` config key and a second `/details` replaces an open selector, mirroring the `/model` overlay. Arguments name target states directly: `collapsed|expanded|hidden` jumps tool cards to that phase, `reasoning on|off` sets reasoning display, bare `reasoning` toggles it, and directives combine in one invocation. An unknown token returns a command error carrying the usage line. Every entry mutates the same closure state as the shortcuts, refactored so the cycle and toggle are thin wrappers over `setToolsVisibility`/`setReasoning`; the shortcuts and their notices are unchanged.

A combined invocation applies reasoning before visibility because `setReasoning` rebuilds the transcript from session events, which drops non-durable notice components; applying it last would erase the just-appended visibility notice.

The reasoning rebuild exposed a replay defect that this change fixes in `renderEvent`: the live path cleared a settled `StreamingAssistantComponent` before a later `assistant/message` of the same step (so the second message got a fresh component), but `rebuildTranscript` replay reused the settled component and `settle()` overwrote its content, silently dropping the earlier message's text. The settled check now lives in `renderEvent`'s `assistant/message` case — one home for both paths — and the previously wrong `untrusted-controls` snapshot (an empty `Assistant` header where reasoning and text had been dropped) was re-recorded with the content present.

## Alternatives considered

**Cycle on bare `/details`, mirroring Ctrl+O.** Rejected: the command's value over the shortcut is naming an absolute state; a cycling command is the shortcut with more keystrokes, and bare invocation is more useful as the selector, which shows the current state while offering every target.

**Bare `/details` as a text-only state report.** Shipped first, replaced by the selector: the report answered "where am I" but still required a second, argument-spelling invocation to change anything, while the selector shows the same state and applies a change in one interaction. The textual grammar remains for scripts, muscle memory, and combined two-dimension changes.

**Separate `/tools` and `/reasoning` commands.** Rejected: both dimensions are one presentation concern ("how much detail does the transcript show"), and a single command keeps the registry and `/help` list small while allowing one combined invocation.

**Config-key defaults per mode.** Out of scope: `showReasoning` already exists as config; the command is runtime state on top of it, matching the shortcuts.

## Consequences

- A user can jump to any detail mode, set both dimensions at once, and see the current state in the selector — including on terminals that intercept Ctrl+O/Ctrl+R.
- The parser accepts order-free tokens, so `/details reasoning expanded` toggles reasoning and expands cards; last directive wins per dimension. This leniency is deliberate and documented in the README.
- The selector has no pending state or cancel: every Tab is a real, already-notified change, and closing never reverts. A user who over-cycles simply Tabs on to the wanted value.
- Transcript rebuilds no longer lose assistant messages when a step carries more than one `assistant/message` event; the `details-command` snapshot pins the argument surface and the fixed replay, and `details-selector` pins the open toggle right after a Tab applied `hidden` -> `collapsed`, including the restored tool card behind it.
