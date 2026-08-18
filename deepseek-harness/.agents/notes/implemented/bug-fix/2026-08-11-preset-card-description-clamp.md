# Agent Note: Preset cards clamp their description instead of sizing the roster

Status: implemented

English | [中文](2026-08-11-preset-card-description-clamp.zh.md)

## Problem

A preset publishes its own `description`, of any length, and the settings section renders the roster as a card grid. The description had a `min-height` and no upper bound, while the grid sizes rows with `grid-auto-rows: 1fr` — which makes every implicit row the same height, not just the row holding the tall card. One long description therefore set the height of the whole roster: with a 250-character description in the custom group, all four cards measured 421px and the short-description cards filled with blank space.

The description is also the field that tells presets apart, so hiding it is not an option; the card has to bound it and still make the whole text reachable.

## Decision

The description clamps to four lines and offers the rest through the shared `Tooltip`, attached only while the element actually overflows (`scrollHeight > clientHeight`, re-measured through a ResizeObserver because the settings pane width follows the window). This mirrors the chat stats line, which clamps to one line on the same measure-then-attach rule.

Card height stays derived rather than fixed. With the description bounded, `grid-auto-rows: 1fr` already equalizes the grid, and a card carrying the broken-preset reason or a revealed path still sizes itself — a pixel height would clip both.

Three smaller decisions ride along:

- `.cardId` takes the card's free space with `margin-top: auto`, and the description no longer grows. A flex-stretched box leaves the clamp height and the box height disagreeing; sizing the clamped box by content alone keeps the behavior independent of that interaction.
- The description carries `title=""`. An empty `title` means the element has no advisory information and the lookup stops there, so the card body's native tooltip does not climb to the description and a cut-off description answers with one bubble instead of two.
- `Tooltip` gains an optional `maxWidth`. Its default half-viewport cap renders a description as a slab wider than the settings dialog it belongs to, spilling across the application behind it.
- `Tooltip` also flips a `top` or `bottom` bubble to the other side when the viewport has no room for it, which its horizontal-only clamp previously left unhandled. Custom presets sit at the bottom of the roster and carry the longest descriptions, so the common case put a tall bubble under an anchor low on the page. The flip only moves into a side that genuinely fits, so an anchor with room on neither side keeps the requested placement rather than oscillating; sliding the bubble vertically instead would cover the text being read.

A roster row that failed its shape check is badged `Failed to load` (`加载失败`) rather than `Broken` (`已损坏`). Discovery sets `broken` when the composition file is missing, unreadable, or malformed — most often a file the user just edited or deleted — so a damage claim overstates what was observed, and the verbatim reason under the badge already names the file and the fix.

## Alternatives considered

- **A fixed card height.** It states the intent directly but clips the two rows whose height legitimately varies: the broken-preset reason and the revealed preset directory.
- **The native `title` attribute carrying the full description.** No measurement and no component, but a roughly one-second delay, operating-system styling, and it takes over the card's `set as default` hint across most of the card's area.
- **Attaching the tooltip unconditionally.** It drops the ResizeObserver, at the cost of answering a hover over a short description with a bubble repeating what is already on the card.
- **Expanding the clamp on hover.** It shows the text in place, and moves the grid under the pointer.

## Consequences

The section owns a small measured component and the shared primitive owns one more optional prop. In exchange, no card's height follows the longest description anywhere in the roster, and the whole description stays in the accessibility tree because the clamp is CSS rather than truncated text.

The `title=""` suppression is pinned by a DOM assertion, not by observing the native tooltip: a browser tooltip is drawn outside the page and cannot be captured. If a browser ever resumes climbing past an empty `title`, the fallback is to drop the card body's `title` — its content is already in the body's `aria-label`.

## Testing

Package tests cover the three measurement outcomes (cut off, fitting, and a runtime without `ResizeObserver`) and the tooltip width cap. The web e2e goldens replay unchanged except `damaged.expected.md`, re-recorded for the badge copy.
