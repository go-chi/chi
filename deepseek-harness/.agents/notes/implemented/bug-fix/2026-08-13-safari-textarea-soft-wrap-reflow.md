# Agent Note: Safari textarea soft-wrap shrink recovery

Status: implemented

English | [中文](2026-08-13-safari-textarea-soft-wrap-reflow.zh.md)

## Problem

The composer keeps the caret and selection in a transparent native textarea while the backdrop paints visible glyphs and the hidden mirror determines the full draft height. The [single-scrollport decision](2026-07-31-composer-text-layers-share-one-scrollport.md) therefore depends on the textarea owning no scrollable overflow: after every draft commit, its `scrollHeight` and `clientHeight` are equal and its `scrollTop` is zero.

Safari 26.5.2 can retain the textarea's former native line layout when Backspace moves a draft across a soft-wrap threshold at the same time that React updates the mirror. In the reproduced two-line-to-one-line transition, the mirror, backdrop, grow stack, and textarea box all become 28px high, but the textarea still reports `scrollHeight=52` and `scrollTop=20`. The caret remains in the stale native line while the backdrop correctly paints one line.

The `color` declaration is not a layout input. Changing its inline style changes the computed color but leaves the stale `52/28/20` state intact. Editing the stylesheet rule happens to trigger broader rule invalidation and clears the state to `28/28/0`, which explains why Web Inspector makes the declaration appear causal.

## Decision

`InputBar` detects Safari once from the Apple vendor and the `Version/... Safari/...` user-agent form, while rejecting known alternate iOS browser tokens such as `CriOS`, `FxiOS`, `EdgiOS`, and `OPiOS`. A browser shell indistinguishable through these identity fields still has to violate the textarea overflow invariant before the recovery mutates layout.

The native textarea change handler records whether an edit shortens the controlled draft. After that draft commits, a layout effect returns without reading geometry unless both the cached Safari identity and the native-shrink signal are present. It then checks the single-scrollport invariant: equal `scrollHeight` and `clientHeight` are settled and trigger no forced layout. A mismatch first changes the textarea's real height by one pixel, forces layout, restores the owned height, and forces layout again. This rebuilds Safari's native text-control layout without changing the value, selection, IME state, or undo transaction.

The temporary native overflow can leave the draft scrollport's auto height at the former line count even after the textarea is correct. The recovery therefore repeats the one-pixel invalidation on `[data-input-scroll]` after repairing the textarea. Both elements return to their owned styles before paint; the settled one-line state is `scrollHeight=clientHeight=28`, `scrollTop=0`, and a 28px scrollport.

## Verification

Component tests synthesize Safari's stale metrics, assert the textarea-then-scrollport invalidation order, preserve selection, and prove that a growing native draft reads no geometry. Browser-identity tests cover desktop and mobile Safari, desktop Chromium, Chrome, Edge, and Opera on iOS, and an Apple web view.

The assembled package is also exercised in Safari 26.5.2 through the native 51-character-to-50-character Backspace path. Playwright WebKit 26.5 settles correctly without the workaround in both the assembled app and a reduced page, so the repository's Chromium browser lane cannot reproduce this Safari application defect; the focused component test pins the engine state until an automatable Safari lane exists.

## Alternatives considered

**Change `color` or use `-webkit-text-fill-color`.** Rejected because inline color changes and transparent text fill leave the stale native geometry unchanged. Stylesheet-rule editing works only because its invalidation scope is broader than the declaration's paint semantics.

**Set `scrollTop=0`.** Rejected because it moves the stale native content without rebuilding its two-line `scrollHeight`; the caret can become clipped instead of aligned.

**Rewrite the textarea value.** Clearing and restoring the value rebuilds Safari's text control, but it mutates the editing state that owns IME composition and selection. The height invalidation leaves the value untouched.

**Use `field-sizing: content`.** Rejected because Safari reproduces the stale two-line intrinsic height after the same deletion, and the composer still needs the mirror as the caret ruler and backdrop metric peer.

**Invalidate only the textarea or only the scrollport.** Rejected because the textarea-only recovery clears `52/28/20` but can leave the scrollport at 52px, while the scrollport-only recovery leaves the textarea's native overflow untouched. The ordered pair is the smallest complete recovery.

**Check geometry after every Safari draft commit.** Rejected because reading `scrollHeight` or `clientHeight` after React changes the mirror can synchronously lay out even a healthy growing draft. A native shortening signal limits the invariant read to edits that can produce the observed shrink defect.

**Run the recovery in every browser.** Rejected because Chromium, Playwright WebKit, and Firefox maintain the invariant without forced layouts. The Safari identity and observed mismatch jointly bound the synchronous work.

## Consequences

Non-Safari browsers, programmatic draft updates, and native edits that do not shorten the draft perform no geometry read. A native Safari shortening reads the overflow invariant and pays the four forced layouts only when the textarea violates it. The exceptional path accepts rare local work before paint to preserve caret alignment, native editing semantics, and the single scrolling box. An equivalent stale state caused only by resize or sidebar width changes has not been observed and is outside this recovery trigger. The browser test gap remains explicit: real Safari evidence owns the engine defect, while deterministic component coverage owns the recovery and its browser gate.
