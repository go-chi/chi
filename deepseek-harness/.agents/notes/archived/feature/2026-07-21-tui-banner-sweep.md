# Agent Note: The banner sweeps in; the subtitle line is gone

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-tui-banner-sweep.zh.md)

> **Superseded** by the [no-banner Agent Note](2026-07-21-tui-no-banner.md): the banner itself was removed, taking the sweep with it.

## Problem

The [startup-slogans Agent Note](2026-07-20-tui-startup-slogans.md) replaced the instructional welcome line with a random slogan bank revealed by a per-character typewriter. In use the quotes read as weird — random flavor text in a tool's header — and the animation was slow (40 ms/char over a full sentence) while animating only one line of a four-line banner. This note supersedes that decision's slogan half; the removal of the configured demo welcome and the animation-lifecycle groundwork stand.

## Decision

- The slogan bank, `pickStartupSlogan`, and the typewriter reveal are deleted. When `welcome` is unset the banner simply has **no subtitle line** — title and model/session detail only. The `welcome` config remains for deployments and fixtures that want a fixed subtitle, rendered frame-deterministically with no animation.
- The startup animation is now the **whole banner**: `HeaderComponent` gains a `revealWidth` clip, and the header box wipes in left-to-right over ~24 frames at 15 ms (~360 ms total, ~60 fps), started after `ui.start()` succeeds and cleared through the same `detachListeners` path the typewriter used. `stopBannerReveal` also resets the clip so a disposed-mid-sweep header re-renders whole.
- The PTY smoke's boot marker changes from the typewriter cursor (`▌`) to the banner's top-right corner (`╮`), which only renders once the sweep completes.

## Alternatives considered

**Keep the animation as-is and only change the copy.** Rejected: any fixed or rotating phrase re-read on every boot decays into wallpaper; the user's judgment was that the quotes themselves, not just their content, were wrong for the surface.

**Animate per banner line (top-down) instead of a left-right sweep.** Rejected: with only four lines the animation would have four visible steps — closer to a flicker than a reveal; the horizontal sweep uses the full terminal width for a smooth motion at the same total duration.

**Character-level clipping via `revealWidth` on styled text.** Adopted with `truncateToWidth` from pi-tui, the same ANSI-aware clipper the header already uses for width overflow, so the sweep cannot tear escape sequences.

## Consequences

- Boot output with `welcome` unset is again animation-dependent but no longer random: every boot sweeps the same banner. Configured welcomes (all snapshot/scripted fixtures, the Code Mode overlay) stay frame-deterministic and unchanged.
- The `STARTUP_SLOGANS`/`pickStartupSlogan` exports are gone; no consumer outside the deleted tests referenced them.
- The default banner is one line shorter (no subtitle), so PTY assertions anchored on banner geometry use the corner glyph rather than any subtitle text.

## Testing

`packages/ui/tui/tests/tui.spec.ts` pins: the sweep completes to a full banner (both corners + title) and produced at least one clipped mid-sweep frame; a configured welcome renders verbatim with no clipped frames; the unset-welcome banner has no subtitle; and dispose clears the sweep's own interval handle. The PTY smoke boots on the `╮` completion marker across the tui-demo bin, the dsh CLI, and the personal-overlay scenarios. Verified live in tmux.
