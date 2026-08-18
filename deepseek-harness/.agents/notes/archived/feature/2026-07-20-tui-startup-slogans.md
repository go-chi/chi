# Agent Note: Startup slogans replace the configured TUI welcome line

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-20-tui-startup-slogans.zh.md)

> **Superseded** for the slogan/animation half by the [banner sweep Agent Note](2026-07-21-tui-banner-sweep.md): the slogan bank and typewriter reveal shipped, read as weird in use, and were replaced by a subtitle-free banner with a whole-banner sweep. The removal of the configured demo welcome and the animation-lifecycle groundwork (start after `ui.start()`, clear through `detachListeners`) stand.

## Problem

The TUI header subtitle came from a `welcome` config the demo leaf set to "TUI agent ready. Give it a coding task." — instructional filler that told a returning user nothing, restated what the product is on every boot, and had a hardcoded twin (`'ready.'`) as the schema default in two packages. The product wanted a startup moment with some character instead of a static banner caption.

## Decision

- `examples/tui-agent/cordis.yml` no longer configures `welcome`; the config key stays for deployments and fixtures that need a fixed, deterministic subtitle (the Code Mode overlay and every snapshot/scripted fixture keep theirs).
- When `welcome` is unset, `dsh-tui` picks one member of an exported `STARTUP_SLOGANS` bank per boot (`pickStartupSlogan`, injectable random source) and reveals it with a typewriter animation: one character per 40 ms frame, a `▌` block cursor trailing until complete. The reveal starts only after `ui.start()` succeeds and its interval is cleared on dispose alongside the other listeners.
- The slogan bank is presentation copy, deliberately not config: deployments that want controlled wording already have `welcome`. Slogans are ASCII-only by contract because the reveal slices per character.
- `dsh-tui-demo` forwards `welcome` only when configured instead of defaulting it, so the app no longer decides the TUI's idle subtitle.
- The keyless PTY boot scenario now waits for the reveal cursor (`▌` — the only source of that glyph in an empty transcript) instead of the removed welcome text.

The same change restores `packages/ui/tui/src/index.ts` to 100 % per-file coverage, which the color-scheme merge had broken on the integration branch: the editor border-color reassignment inside `applyColorScheme` was dead (the `setStatus` call right after re-derives it) and is removed, and the color-scheme query's `.then`/`.catch` arrows became named, tested handlers (`applyReportedScheme`, `ignoreSchemeQueryFailure` — the latter pinned by a test whose terminal throws on the DSR query write).

## Alternatives considered

**A fixed cooler slogan.** Rejected: one string re-read on every boot decays into wallpaper exactly like the line it replaces; a small rotating bank keeps the moment alive at no complexity cost.

**Making the bank and reveal speed configurable.** Rejected: that is two new knobs for presentation copy; `welcome` is already the escape hatch for deployments with an opinion, and the no-hardcoded-tunables rule targets deployment-varying behavior, not brand copy.

**Animating in `HeaderComponent` itself.** Rejected: the component would need a TUI handle and its own lifecycle; the chat already owns a render loop, timers, and a disposal path, so the reveal lives beside the other `createTuiChat` effects and `detachListeners` clears it.

## Consequences

- Boot output is no longer byte-deterministic when `welcome` is unset (random slogan, timed frames). Every recorded or snapshot surface pins `welcome` explicitly, so no snapshot changed; the PTY smoke anchors on the reveal cursor and the session-id line instead.
- The `welcome` schema default disappeared from both `dsh-tui` and `dsh-tui-demo`; a direct caller passing no welcome now gets a slogan, not `'ready.'`.
- Adding a slogan is a one-line bank edit; tests assert membership, not specific text.

## Testing

`packages/ui/tui/tests/tui.spec.ts` pins deterministic bank selection with an injected random source, the reveal (a bank member fully rendered, cursor frames observed), the configured-welcome path rendering verbatim with no cursor, and dispose stopping a mid-reveal animation. `examples/tui-agent/tests/tui-keyless-smoke.e2e.ts` boots the real tree in a PTY and waits on the reveal cursor. Verified live in tmux (mid-reveal frame `no map below▌` then the full slogan).
