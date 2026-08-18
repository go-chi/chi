# Agent Note: Question-composer option rows are scroll content, not the slack absorber

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-27-question-composer-rows-do-not-shrink.zh.md)

## Problem

The question composer card is capped against the viewport (`max-height: min(60vh, 520px)`) and scrolls its option list, so the header and the footer actions stay reachable on long question batches. When the composer seat got short — a small window, or a short viewport with the details panel open — the option rows rendered on top of each other and on top of the question title.

The cap was not the defect; the distribution of the shortfall was. `.options` is a `flex-direction: column` box whose children default to `flex-shrink: 1`, so under-allocation shrank the rows first instead of overflowing the scroll container. A row shrank to its `min-height: 42px` while `.optionCopy` kept the taller intrinsic height its wrapped copy needs (two lines for an option with a description). With `align-items: center`, the copy is then centered on a box shorter than itself and paints outside the row's border box in both directions — over the title above and the next row below. Measured on the shipped client at 900x440: 6.5px of copy outside the row box, growing to 10px at 380px tall, while `.options` reported `scrollHeight === clientHeight` and therefore never offered a scrollbar.

Only rows whose copy wraps can reproduce it. A row whose copy fits on one line has slack between its content and its 42px minimum, so shrinking it stays invisible — which is why the pre-existing e2e fixture (options `Blue`/`Green`, no descriptions) rendered correctly at every size.

## Decision

`.option` and `.custom` declare `flex-shrink: 0`.

The rows are the scroll content of a capped card; the card's overflow belongs to `.options`, which already owns `overflow-y: auto` and `min-height: 0`. Pinning the children makes the shortfall reach that scroll container instead of being absorbed by the rows, which is the behavior the cap was designed for. The alternative — letting rows shrink but keeping the copy inside them — would require clipping or ellipsizing option descriptions at exactly the sizes where the user most needs to read them.

`.header` and `.footer` already carried `flex-shrink: 0` for the same reason at the card level; the option list's children were the missing half of that rule.

## Alternatives considered

**Clip or ellipsize the copy inside a shrunk row (`overflow: hidden` on `.option`).** This removes the overlap with one declaration and no layout rethink. Rejected because it trades a visible defect for a silent one: the row keeps its 42px, and the second line of an option description simply disappears at exactly the sizes where the card is tightest. The description is decision-relevant content, not decoration.

**Drop `align-items: center` for `align-items: flex-start`.** The copy would grow downward only, so it would no longer paint over the title above. It does not fix anything: a shrunk row still overflows onto the row below, and the fix would silently change the vertical alignment of every option row at every size, including the common one.

**Remove the card's `max-height` cap so nothing is ever squeezed.** No shortfall means no distribution problem. Rejected because the cap is what keeps the header and the footer actions on screen for a long question batch; removing it reintroduces the failure the cap exists to prevent (the composer seat is a fixed-height conversation column with `overflow: hidden`, so an uncapped card loses its own submit button instead).

**Cap the wrapped copy at one line (`white-space: nowrap` plus ellipsis on `.description`).** Rows would never wrap, so they could never overflow when shrunk. Rejected for the same reason as clipping, plus it degrades the wide-viewport rendering — where there is ample room — to fix a narrow-viewport defect.

## Consequences

- A squeezed composer scrolls its option list instead of overlapping it: at 900x380 the list reports `scrollHeight` 200 against `clientHeight` 114 and offers a scrollbar, where before it reported them equal and offered none.
- Option rows keep their full wrapped copy at every viewport size. Nothing is clipped or ellipsized, and the wide-viewport rendering is unchanged (the rule only takes effect when the flex box is under-allocated).
- The card now reaches its scroll state sooner, since the shortfall is no longer partly absorbed by the rows. That is the intended behavior of the cap, and it means a short seat shows a scrollbar in cases that previously showed a silently mis-painted list.
- The scenario's recorded question is longer than it needs to be for the round trip it primarily tests. That cost is deliberate: the layout invariant is unfalsifiable without wrapping copy, and a second fixture for one CSS rule would be worse.

## Verification

The web e2e composer scenario asserts the invariant on the live composer at three squeezed seat heights (900x520 / 440 / 380): every option row's children stay inside the row's border box. Two guards keep the assertion from holding vacuously — at least one row must be wrapped (the only shape that overflows) and `.options` must actually be scrolling (proof the seat is genuinely capped). The scenario's recorded question now carries long option descriptions for exactly that reason; without wrapping copy the assertion cannot fail.

Confirmed both directions against the built client: with `flex-shrink: 0` reverted the scenario fails (`scrolls: false`, 6.5px spill), and with it restored it passes. A standalone geometry sweep over 340 viewport sizes (420-1600 x 320-960) went from 86 sizes with copy outside a row box to zero.

The assertion is replay-only: record mode must reach the fixture write rather than aborting on layout. Note that the composer ships as a client-module bundle, so `pnpm run build:web` alone does not pick up a change to `QuestionComposer.module.css` — the package build must run for the browser lane to see it.

Reproducing the shortfall requires a short viewport, not a short container. The cap is `min(60vh, 520px)`, so shrinking the conversation column below the card's own height clips the card without under-allocating it — the rows keep their full height and nothing spills. Anything demonstrating or measuring this defect outside the e2e scenario has to change the viewport.

A stale `lib/` makes the browser lane assert against an older client than the tree, and a `pnpm run build` that fails part-way leaves exactly that: the packages built before the failure are current, the rest are not. Refreshing a golden in that state records the older client's surface. Confirm the build exited zero before capturing, and note that untracked directories under `packages/` are compiled too — a leftover from another branch can fail the build for reasons the diff does not explain.
