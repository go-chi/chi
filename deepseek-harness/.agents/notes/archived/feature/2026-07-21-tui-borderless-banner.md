# Agent Note: The banner returns, borderless

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-tui-borderless-banner.zh.md)

## Problem

An intermediate no-banner design removed the boxed startup banner: it deleted `HeaderComponent` and its sweep, moved the model into the footer, dropped the session id, and rendered `welcome` as the transcript's first line. The user's verdict reversed that: bring the banner back — "just remove the border". The four-row box frame was the objectionable chrome, not the identifying facts it carried (model, session id) nor the sweep-in motion.

## Decision

- `HeaderComponent` and its left-to-right sweep return, but render **borderless**: no `╭─╮`/`╰─╯` corners and no `│` side bars. Each line is a single leading space plus `truncateToWidth`-clipped content, so the sweep's width clip can never tear an escape sequence and no fixed frame is drawn. The reveal advances through about 24 frames at 15 ms each.
- The header carries the title (`DEEPSEEK HARNESS`), a `<model>  •  <session-id>` detail line, and — when `welcome` is set — a muted subtitle. With `welcome` unset the header is title + detail only: there is no fixed or random slogan.
- The model **also** stays in the footer's left segment, so the driving model remains glanceable after the transient banner scrolls out of view.
- `welcome` reverts to a banner subtitle; the transcript-first-line notice is removed from `rebuildTranscript`.
- The sweep animates only when `welcome` is unset. A configured `welcome` renders the whole banner immediately, keeping fixtures and snapshots frame-deterministic. The sweep starts after `ui.start()` succeeds and is cleared through the same `detachListeners` path via `stopBannerReveal`, which also resets the clip so a header disposed mid-sweep re-renders whole.

This note owns the current result of the discarded startup variants: random slogans with a per-character typewriter, a boxed whole-banner sweep, and no banner. The example composition does not set `welcome`; deployments and deterministic fixtures may still provide one. The model's persistent footer home from the no-banner variant remains.

## Alternatives considered

**Keep the box but thin it or use lighter glyphs.** Rejected: the instruction was "just remove the border"; any surrounding glyph is the frame chrome the user objected to.

**Keep a random or fixed slogan when `welcome` is unset.** Rejected because repeated flavor copy becomes wallpaper and the per-character reveal was slow while animating only one line. An unset welcome therefore produces no subtitle, and the whole banner supplies the startup motion.

**Remove the banner entirely.** Rejected because the persistent footer is a good home for the model but not for the full identifying detail, while putting `welcome` in the transcript makes presentation configuration behave like conversation content.

**Reveal the banner top-down.** Rejected because four row-sized steps read as a flicker. The horizontal width clip uses the terminal span for smooth motion and reuses the ANSI-aware truncation path.

**Drop the model from the footer now that the banner shows it again.** Rejected: the banner is transient and scrolls away with the transcript, while the footer keeps the model visible for the whole session; that persistent location is deliberately preserved.

**Leave the session id out of the banner.** Rejected: with the box gone the detail line costs one row, and the user asked for the banner "as before", which carried `model • session-id`.

## Consequences

- Boot output with `welcome` unset is animation-dependent again (the sweep); configured welcomes stay frame-deterministic, so every snapshot and scripted fixture keeps a fixed subtitle.
- The demo no longer supplies instructional welcome filler; an unset `welcome` means a subtitle-free banner, while the config remains the deterministic escape hatch for deployments and fixtures.
- The model now appears twice at boot — banner detail and footer — intended redundancy: the banner is transient, the footer persistent.
- `/clear` empties the transcript but not the header, so the banner and its configured subtitle survive `/clear`, unlike a transcript-based welcome line.
- All pi-tui terminal snapshots and the examples/tui-agent replay snapshots re-recorded (`test:snapshot:refresh`): banner rows return with no box glyphs; footer rows keep the model prefix.
- Anything that anchored on banner absence re-anchors on its presence: the PTY smoke boots on the detail line's `main-session-` id (revealed late in the sweep) and asserts `DEEPSEEK`/`HARNESS` present with no box corners.

## Testing

`packages/ui/tui/tests/tui.spec.ts` pins: the borderless banner sweeps to natural completion — no box corners, title and `main-session` detail present — with at least one clipped mid-sweep frame; a configured `welcome` renders the whole banner with no clipped frame; the unset-welcome banner has no subtitle; and dispose clears the sweep interval mid-sweep. Independent color-scheme cases cover reported light/dark transitions, a same-scheme no-op, and a terminal that throws on the DSR query write; `applyColorScheme` relies on `setStatus` to rederive the editor border instead of repeating the dead assignment that had broken per-file coverage. The tui-agent and dsh-CLI PTY smokes boot on the `main-session-` detail marker and assert no box corners. Snapshots verify the full frames.
