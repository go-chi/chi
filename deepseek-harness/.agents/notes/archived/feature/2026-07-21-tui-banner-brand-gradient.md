# Agent Note: TUI banner brand gradient

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-tui-banner-brand-gradient.zh.md)

## Problem

The TUI startup banner rendered the product name `DEEPSEEK` in the palette's flat accent color, which carries no brand identity and does not resemble the wordmark on deepseek.com. The request was to make the banner match the site logo's blue gradient specifically — not to recolor the rest of the coding harness.

The banner is the one surface where that matters, and it conflicts with a load-bearing invariant: the TUI palette is deliberately theme-agnostic. It uses only standard 16-color ANSI (SGR) codes and attributes so a user's terminal scheme remaps every color; the `themeViolations()` snapshot gate rejects any RGB, extended-palette, or explicit-background cell. A smooth logo-matching gradient cannot be built from 16 palette colors, so reproducing it requires 24-bit truecolor, which the gate flags by design.

## Decision

The banner paints `DEEPSEEK` with a per-letter 24-bit truecolor foreground sweeping the deepseek.com brand gradient — `#4D6BFE` → `#3982FF` → `#2498FF` — via piecewise-linear interpolation across those three stops; `HARNESS` stays bold with the default foreground. The gradient is foreground-only, so it stays legible on any terminal background, and it is confined to the banner's product name. This is the sole sanctioned exception to the theme-agnostic palette; every other surface remains standard-ANSI and theme-adaptive.

The gradient is gated on `resolved.color && resolved.truecolor`. When truecolor is unavailable the banner falls back to the existing flat bright-blue accent, so nothing about the theme-agnostic guarantee or the recorded snapshots changes unless truecolor is explicitly in play.

`truecolor` is a validated `Config` field with no schema default. When it is unset, `apply()` auto-detects it at the process boundary from `COLORTERM` (`truecolor` or `24bit`); an explicit config value always wins. Detection reads `process.env` only in `apply()` — never in the pure `resolveTuiConfig` resolver — keeping the resolver a pure function of its input.

The gradient stops are fixed brand identity, treated like a protocol constant, so they are hardcoded in the plugin rather than exposed as a tunable. Whether truecolor is *enabled* is terminal- and deployment-varying, so that is the validated `Config` field. The banner text is UI-only and never reaches a model request, so no session event is required.

## Testing

A dedicated `banner-gradient` terminal snapshot pins the real per-letter RGB output in an xterm emulator (`fg=#4d6bfe`…`#2498ff`, each letter bold). The shared `checkpoint()` helper takes a `bannerGradient` flag: for that one checkpoint it asserts the theme violations are non-empty and that every violation ends in `rgb-fg` — i.e. truecolor is present but confined to the banner foreground, with no background or extended-palette leak. Every other checkpoint keeps the strict `themeViolations()` `.toEqual([])` assertion, so the fence is mechanically enforced. A `tui.spec.ts` unit test mounts with `color`+`truecolor` enabled to cover the header's gradient branch and the `gradientText`/`brandColorAt` helpers.

## Alternatives considered

**A theme-safe stepped gradient built from the 16-color palette.** Approximating the sweep with bright-blue palette variants would keep the banner fully theme-agnostic and avoid touching the gate. It was rejected by the requester: 16 fixed colors cannot reproduce the smooth logo gradient, and the request was explicitly to match the site wordmark.

**Recoloring the whole harness palette blue.** The original phrasing was "update the harness color to blue." That was narrowed to the banner only; a global blue palette would break theme-agnosticism everywhere, not just on one brand surface.

**Always emitting truecolor.** Many terminals lack 24-bit support and would render the raw or degraded codes. Gating on detection with an ANSI fallback keeps the banner correct everywhere while still showing the gradient where it works.

**Detecting truecolor inside `resolveTuiConfig`.** The resolver is a pure defaulting step and must not read `process.env`. Environment probing belongs at the process boundary in `apply()`, so `mountTui`/`createTuiChat` stay driven purely by their config input and remain fully testable with a fake terminal.

## Consequences

The banner now carries the DeepSeek brand identity on truecolor terminals while the theme-agnostic guarantee holds everywhere else — and even on the banner itself when truecolor is unavailable. The cost is one narrow, documented crack in the theme-agnostic invariant: a fixed-color surface that will not adapt to a user's terminal scheme, accepted because it is brand identity and foreground-only, so it stays legible on both light and dark backgrounds. The crack is fenced by the `banner-gradient` snapshot assertion, which confines truecolor to the banner foreground and fails if any other RGB, extended-palette, or background color ever appears.
