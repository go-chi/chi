# Agent Note: TUI prompt themes compose mutable plugin values

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-24-configurable-tui-prompt-theme.zh.md)

## Problem

The terminal prompt row and editor prefix were assembled inside the TUI from a fixed set of workspace, model, usage, cache, context, and timing fields. Deployments could change colors globally but could not choose field order, replace the input prefix, add plugin state, or build a Powerline prompt.

## Decision

The TUI theme groups `color`, `truecolor`, `leftPrompt`, `rightPrompt`, `inputPrompt`, and the static running-state `inputPlaceholder`. The three prompt strings interpolate `${name}` references; unknown or unavailable values disappear with adjacent horizontal separator whitespace. The left and right templates share one row, retain the right side on overlap, and use ANSI-aware visible widths. The input template controls the first-line editor prefix and continuation indentation.

`ctx.tuiPrompt` is a context-global registry supplied by `@deepseek-ai/dsh-tui/prompt`. `register(name, initialValue)` returns a handle with `set(value)` and `dispose()`. Values are stored strings rather than callbacks: updates are explicit, unchanged strings are ignored, and a registration, mutation, or disposal schedules one coalesced notification. The renderer reads current values with `get(name)` and subscribes with `subscribe(listener)` to learn when to redraw. That subscription is a direct in-service callback, not a Cordis event, so a value changing on its own schedule still repaints without a bus entry other consumers would never use. Both `subscribe` and each registration are owned by the caller's Cordis effect, so they are removed when the subscriber's or contributor's fiber disposes. Each `subscribe` call is a distinct subscription keyed by record identity, so two fibers may pass the same callback and disposing one leaves the other live. The coalesced notification contains every observer — a synchronous throw, a rejected returned promise, and even an error hostile to string rendering (logs go through the non-throwing `errorChain`) — so one broken observer cannot starve the rest, and it re-checks each subscription's liveness during delivery so a listener that synchronously unsubscribes another in the same burst silences it immediately. Registration follows Cordis effect ownership, rejects duplicate names, and removes the value on plugin disposal.

Registered fragments are trusted ANSI-capable presentation output. Template literals and ordinary external content remain sanitized, but a prompt-value plugin may emit terminal controls. Composite values own coordinated background transitions and separators, so one `${powerline}` value can render a complete Powerline segment without coupling adjacent atomic providers.

The built-in `cwd`, `git/worktree`, `token_meter/cache_hit_rate`, `model`, `context`, `queued`, styled `symbol` label, and `indicator` caret values use the same registry. Session and agent events update their handles, while the running timer updates `queued` — the steering-queue badge, unavailable unless a running turn has queued messages — and the animated `indicator` each tick. The shipped input template is `${symbol} ${indicator}`, preserving the existing `dsh > ` prefix.

## Alternatives considered

**Evaluate synchronous provider callbacks on every render.** Rejected: render-time plugin code adds an avoidable failure boundary; stored strings keep the render pass free of plugin evaluation.

**Publish the change notification as a Cordis event.** Rejected: the notification has exactly one consumer (the TUI renderer for the current session), so a global typed event adds a bus entry, scoped-dispatch surface, and cross-plugin fan-out no one else observes. A direct `subscribe` callback contained inside the service carries the same coalesced redraw with less surface.

**Expose semantic style roles instead of ANSI.** Rejected: semantic roles cannot express arbitrary Powerline background transitions without expanding the shared style protocol for each presentation technique.

**Put prompt fields at the top level of TUI config.** Rejected: templates and color selection jointly define terminal presentation and belong under one `theme` object.

## Consequences

Prompt contributors depend on the TUI-specific registry and are loaded after the service but before the TUI consumer. The namespace is global to the Cordis context, matching the TUI's current single-session transcript ownership. Arbitrary ANSI is intentionally trusted: unsupported cursor-affecting sequences can disrupt layout, and alignment is reliable only for sequences understood by pi-tui's visible-width utilities.

Changing `inputPrompt` through a registered value preserves editor text, cursor, history, completion, and focus because pi-tui supports replacing equal-width first and continuation prefixes in place. The static `inputPlaceholder` is sanitized and appears only while the agent runs and the editor is empty.

## Testing

Registry tests pin validation, duplicate rejection, updates, unavailable values, coalesced-notification containment, unsubscribe, disposal, interpolation, trailing-literal retention, whitespace cleanup, and ANSI preservation. TUI package tests pin service availability, nested theme defaults, config forwarding, custom templates, out-of-band value redraw, mutable redraw, Powerline-capable fragments, dynamic input-prefix width, and the static running placeholder. A deployment shipping the TUI owns assembled load-order acceptance.
