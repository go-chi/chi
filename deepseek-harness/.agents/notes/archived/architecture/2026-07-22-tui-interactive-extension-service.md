# Agent Note: Effect-owned TUI interactive extensions

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-22-tui-interactive-extension-service.zh.md)

## Problem

Cordis plugins can register human commands through `ctx.commands`, but a command that needs terminal interaction has no supported presentation boundary. It must either remain non-interactive or capture the TUI's private pi-tui tree, focus state, renderer, and shutdown lifecycle. That coupling makes the extension depend on one front door's internals, lets independently developed overlays compete for focus, and leaves plugin unload with no reliable way to remove queued or visible UI.

## Decision

A mounted `@deepseek-ai/dsh-tui` provides `ctx.tui` after terminal startup succeeds. The service belongs to that exact terminal and agent, disappears before terminal teardown, and causes plugins that inject it to unload and reload with provider availability. Other front doors do not emulate it.

`ctx.tui.openOverlay()` is the first and only interactive extension primitive. It accepts a component factory, constrained layout options, and an optional abort signal. The factory receives a frozen host with the current viewport, semantic theme functions, display-text escaping, redraw, close, and a lifetime signal. It does not receive the pi-tui `TUI`, overlay handle, editor, transcript tree, focus controller, or terminal object.

One private overlay manager serializes built-in and plugin requests in FIFO order. The model selector and `ctx.userInteraction` question panel use the same manager, so all modal interaction has one focus owner. Closing the active overlay restores pi-tui's previous focus before the next request activates. Overlay state is process-local presentation: it is neither appended to the session log nor rebuilt during resume.

The service method runs through Cordis's traceable service proxy. It installs an effect on the calling plugin fiber before admitting the request; caller disposal therefore removes a queued request or closes an active overlay and awaits the same settled outcome. TUI shutdown first rejects admission, then disposes the service fiber so dependent plugins and their effects quiesce, settles remaining built-in work, and only then drains and stops the terminal.

Component construction, rendering, input, and invalidation run behind an exception boundary. A failure closes that request with an `error` outcome, reports a visible terminal error, and lets the queue continue. Components are trusted package code: their rendered lines may contain ANSI styling, and they must call `host.display()` before including untrusted text.

## Verification

Manager tests pin FIFO admission, cancellation, repeated close, shutdown outcomes, guarded callbacks, host capabilities, and per-file coverage. Cordis lifecycle tests pin caller ownership, provider loss and return, unloading-time rejection, and cleanup quiescence. Fake-terminal integration tests exercise plugin overlays alongside built-in questions, restored editor input, terminal remount, startup rollback, and service disappearance. Existing TUI interaction tests continue to exercise the model selector and question panel through the shared path.

## Alternatives considered

**Expose pi-tui objects directly.** This gives plugins maximum freedom but makes private focus, rendering, and teardown state a public compatibility contract. It also cannot arbitrate independently loaded overlays.

**Put interactive callbacks on command definitions.** Commands remain transport-neutral domain entries even though TUI is their only shipped consumer. Adding terminal state to `ctx.commands` would couple discovery and dispatch to one presentation implementation.

**Create a complete TUI slot and action framework at once.** Actions, editor replacement, transcript renderers, status regions, and completion providers have different composition and conflict rules. Shipping them behind one broad API would freeze those rules before a concrete consumer proves them.

**Persist open overlays in session events.** Modal presentation is not model-visible session state, and arbitrary component state is not replayable. The plugin that owns durable data records that data through its domain service and recreates presentation when appropriate.

## Consequences

Interactive plugins gain a small stable front door with deterministic focus and Cordis-owned cleanup, while the TUI keeps authority over terminal lifecycle and pi-tui internals. Built-in dialogs and extensions cannot overlap or strand focus.

The API deliberately covers modal overlays only. Human command registration remains on `ctx.commands`; actions, slots, editor replacement, event renderers, and completion providers require separate contracts when real consumers establish their ordering and ownership semantics. FIFO serialization also means one stalled overlay blocks later modal work until its owner closes, aborts, or unloads it.
