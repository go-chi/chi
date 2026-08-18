# Agent Note: Versioned TUI first-run welcome

Status: implemented
Archived: 2026-08-03

English | [中文](2026-07-30-versioned-tui-first-run-welcome.zh.md)

## Problem

The shipped `dsh` terminal starts directly in the editor and gives first-time internal testers no durable orientation about the product's maturity or feedback channel. The existing one-line `welcome` banner subtitle cannot carry the supplied notice without crowding the normal session header, and putting onboarding in the session log would create a user turn or model-visible context that is unrelated to the user's work.

The notice also needs a recognizable DeepSeek composition without copying another product's startup art or maintaining a hand-drawn approximation that drifts from the official mark.

## Decision

The official `dsh` launcher owns one versioned acknowledgement marker under the resolved `DSH_HOME`. It checks the immutable marker before boot, then mounts an effect-owned consumer of `ctx.tui.openOverlay()` only after the real TUI service is available. Enter is the sole acknowledgement action: the plugin creates and synchronizes the fixed per-version marker before closing. Escape and unrecognized input leave the overlay open; Ctrl+C and Ctrl+D use the normal exit path without acknowledging. Disposal waits for an acknowledgement already started by Enter, while disposal or process exit before Enter writes nothing. The version is part of the marker filename, so incrementing the centrally owned notice version presents materially revised copy once without migrating or rewriting an aggregate settings document.

The marker is launcher state rather than session persistence because eligibility spans sessions and workspaces but is scoped to one Harness home. Each Enter syncs a random same-directory file before atomically replacing the fixed marker; concurrent launches publish the same immutable fact, so same-value last-writer-wins replacement has no lost-update shape and needs no lock or dependency on the settings stack. The notice never appends a session event, injects model context, or creates a user turn; resume therefore presents it only when the same Harness home has not acknowledged that version and never replays it from the session log.

The supplied official `24x24` DeepSeek SVG is committed as the visual source. Static full, compact, and minimal terminal rasters sample that exact path at decreasing square resolutions; they do not redraw the contour. Unicode `▀`/`▄`/`█` cells preserve two vertical source pixels per terminal cell, while an explicitly ASCII-only locale uses the bit-equivalent `'`/`_`/`#` fallback. ANSI styling stays outside both the SVG and editable copy: `ctx.tui` supplies a semantic `brand` role, using the official `#4D6BFE` ink when truecolor is available, standard ANSI blue otherwise, and plain text when color is disabled. The normal startup banner retains its existing gradient.

The overlay is centered and consumes the available terminal width, while its height follows actual content and treats 90% of the viewport only as an upper bound. Wide terminals place the full icon beside the title and prose; medium and narrow terminals stack the compact or minimal icon above them; low height removes the icon before reducing prose space. The prose scrolls while the title and only action remain fixed. Every locale uses the same centrally owned Chinese copy, and the quotation is promoted to its own visual paragraph without changing that string. Closing through Enter returns modal ownership to the existing FIFO manager, which restores the editor and leaves the normal startup banner, transcript, and focus behavior intact.

## Verification

Focused unit coverage pins the supplied SVG and Chinese copy hashes, version bumps, exclusive concurrent acknowledgement, malformed markers, persistence retry, Escape behavior, ASCII fallback, width-tier selection, bounded rendering, and low-height scrolling. Real Loader/PTY cases cover 60, 80, 120, and 160 columns plus a low-height viewport, emit semantic terminal snapshots, prove first launch then second-launch suppression under one `DSH_HOME`, and prove a resumed session appends no notice-derived user message or turn; ordinary terminal-exit lifecycle events remain unchanged.

## Alternatives considered

**Reuse the TUI `welcome` subtitle.** It is one transient header line whose normal job is to identify an untitled session. The required prose and action would either be clipped or permanently crowd ordinary launches.

**Copy Claude Code's startup art or composition.** Its strong hierarchy is useful product evidence, but its graphic, layout, and brand treatment belong to another product. The official DeepSeek SVG provides a direct brand source, and the terminal composition is derived independently around this notice's copy and responsive constraints.

**Hand-draw an original whale.** A freehand silhouette can be recognizable yet still disagree with the official mark's body, internal negative space, fin, and tail. Exact-path raster sampling keeps the terminal limitation explicit and makes every tier traceable to one source asset.

**Store a boolean in session events or a shared settings document.** Session state has the wrong lifetime and would pollute replay or model-visible history. An aggregate document would require cross-process read-modify-write locking for one immutable fact; an atomically replaced version marker has no lost-update shape.

**Allow Escape or a later-reminder action.** Either would make dismissal indistinguishable from acknowledgement or introduce reminder policy that the notice does not need. Normal process exit remains the abort path and leaves the version unacknowledged.

## Consequences

Each Harness home receives the notice once per copy version, only after a successful Enter acknowledgement. Maintainers can edit the all-locale Chinese wording and version in one small owner file, and can update the official SVG and derived static rasters in their separate visual owner without chasing snapshots for full prose copies.

The terminal cannot display SVG vectors directly, so its faithful representation is resolution-bounded. Smaller tiers preserve the sampled silhouette but necessarily lose fine detail; low-height terminals prefer readable prose and an always-reachable action over brand art. The marker format is intentionally one-file-per-version during the pre-release period; old markers are harmless and no compatibility reader is required.
