# Agent Note: Dim-gray pulse for the running prompt glyph

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-27-tui-running-glyph-smooth-fade.zh.md)

## Problem

While a turn runs, the TUI replaces the `>` prompt caret with a phase glyph (`◍`/`✻`/`●`/`⚙`). Earlier iterations animated its brightness in the accent blue (a discrete SGR wave, then a truecolor throb) — a colored, always-pulsing indicator. The desired effect keeps the continuous pulse to signal ongoing work, but as a quiet dim gray rather than a color, and with smooth fade-in and fade-out at its edges.

## Decision

The running glyph is a dim gray that fades in on turn start, throbs continuously while the turn runs, and fades out after it ends before the plain `>` caret returns. It is never the accent color.

Brightness is a fade envelope times a running throb. The envelope gates appear/disappear, linear in the render clock over `STATUS_FADE_MS = 300`: `(now − startedAt)/FADE` clamped for fade-in, `1 − (now − endedAt)/FADE` for fade-out. `pulseLevel` is a cosine between `STATUS_PULSE_FLOOR` (0) and 1 over `STATUS_PULSE_PERIOD_MS = 1400`, so each breath swells from fully invisible to full and back. The truecolor opacity handed to `fadeGlyph` is `envelope × pulse`.

`fadeGlyph` renders at that opacity. With truecolor, below `STATUS_FADE_MIN_OPACITY` (0.12) the glyph is hidden entirely — a blank column — so the pulse trough disappears rather than lingering as a near-background gray; above it the glyph interpolates a 24-bit gray between `STATUS_FADE_GRAY.trough` and `.settled` (the same dim gray as the idle caret), emitting `\x1b[38;2;r;g;bm`, so both the fade and the throb are brightness. Without truecolor there is no per-frame gray, so a separate `visible` flag — driven by the envelope alone, not the pulsing opacity — shows the glyph in the palette's muted role or leaves a blank column; the throb never blinks the fallback. With color off entirely a visible glyph is bare, preserving the caret column on a monochrome terminal.

The running prompt refreshes at `STATUS_ANIMATION_INTERVAL_MS = 50` (~20 fps) so the throb moves every frame; the same tick keeps the 0.1 s-resolution elapsed text current, so no separate timing timer exists.

Fade-out outlives the turn: on the running → non-running edge `beginFadeOut` hands the last rendered glyph to a `FadingStatus` whose own timer re-renders until the fade window elapses, then calls `clearStatus` and restores `>`. Teardown paths (dispose, agent-disposed, startup-failure) call `clearStatus` directly, stopping both the running and fading timers at once — no lingering fade. The glyph handed to the fade-out is the last live phase glyph (`runningStatus.lastGlyph`), not the ttft fallback the phase derivation returns once the closing turn's step has ended.

The glyph character and its cell never change — only the gray brightness — so the caret column stays fixed across frames and across the caret↔glyph transitions.

## Alternatives considered

**Keep the accent color.** The pulse is wanted, but as a quiet gray matching the idle caret's tone, not a colored indicator; the accent is removed while the throb stays.

**Hold steady while running (no throb).** A steady dim glyph was tried and rejected: a continuous pulse better conveys that the agent is actively working. The throb returns, in gray.

**A non-zero floor that keeps the trough faintly visible.** Successive floors (0.45 → 0.15 → 0.02) each kept the dimmest point too visible to read as truly quiet; even 0.02 sat at gray ≈ 45, one step off the background. A floor of 0 with an explicit visibility threshold (`STATUS_FADE_MIN_OPACITY`) instead hides the glyph entirely at the bottom of each breath, so the trough is genuinely absent. Because the swell is a smooth cosine, the disappearance reads as a soft fade-out, not the hard on/off blink a low-but-nonzero gray toggle would give.

**Pulse the non-truecolor fallback too.** SGR exposes only three intensity levels, too coarse for a smooth throb, and toggling the glyph on/off across the pulse would blink it. The fallback instead shows a steady muted glyph gated by the envelope; only truecolor terminals get the throb.

## Consequences

The running glyph reads as a quiet gray breath that swells from nothing to a dim mark and back the whole turn, matching the idle caret's tone, at the cost of a faster render tick (50 ms) while a turn is active or fading out; the diffing terminal only re-emits changed cells, so the extra frames are cheap. The fade-out means the indicator lingers ~300 ms after a turn completes. Snapshots run non-truecolor with a frozen clock, so they pin only the steady muted glyph (envelope-gated), not the throb; the truecolor invisible trough, the settled peak, a rising mid-frame, the fade-out, and the non-truecolor appear/disappear are pinned by unit tests in `tui.spec.ts`.
