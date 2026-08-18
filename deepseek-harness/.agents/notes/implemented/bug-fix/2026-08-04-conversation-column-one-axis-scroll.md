# Agent Note: The conversation column scrolls on one axis

Status: implemented

English | [中文](2026-08-04-conversation-column-one-axis-scroll.zh.md)

## Problem

Narrowing the center column — by the window or by the sidebar drag — put a horizontal scrollbar under the whole conversation column on the hero. The bleeding element is the hero's decorative backdrop ellipse: `.heroGlow` is sized `1051/776` of the hero box so its blur scales in userSpace with the input card, which means it reaches past the column whenever the column is narrower than the glow.

That bleed is by construction and stays. What made it user-visible is the scroll container it sits in. `[data-conversation-scroll]` declared `overflow-y: auto` and left the other axis at its initial `visible`, and a box that scrolls in one axis computes `visible` to `auto` in the other. Every column narrower than the glow therefore offered a real horizontal scroll range — measured at 24–95px across the widths a laptop actually produces.

## Decision

`.scrollBody` declares `overflow-x: hidden`. The column states that it is a one-axis scroller instead of leaving the second axis to be derived.

Clipping does not change. `overflow-y: auto` had already made the box a scroll container that clips both axes, so the declaration withdraws only the scrollbar and the user gesture; the glow keeps its bleed, its blur radius, and the same painted extent, and the column keeps its vertical scroll. Nothing in the composer chain moves.

## Alternatives considered

**Size the glow to fit the column.** Rejected. The glow's width is what scales its `stdDeviation="50"` blur with the input card (figma 313:14109); constraining it would make the blur tighten as the column narrows, which is a visual regression to fix a scrollbar.

**Wrap the glow in a clipping box.** Rejected. It adds a box whose only job is to undo an overflow the column already clips, and it leaves the derived `overflow-x: auto` in place for the next element that bleeds — the transcript is full of candidates.

**Rely on the frame's `.centerCol { overflow: hidden }`.** It cannot help. That clip is outside the scroll container, so it hides the glow's overhang at the column border while the container inside it still scrolls to reach it. The reported bar was that container's.

**Assert `scrollWidth === clientWidth` in the test.** Rejected as the signal, because it does not distinguish the states: `hidden` clips the bleed rather than reflowing it away, so the scroll range reads the same on both sides of the fix. Only refusing a user gesture differs, which is what the scenario measures.

## Testing

[apps/web/tests/conversation-column-overflow.e2e.ts](../../../../apps/web/tests/conversation-column-overflow.e2e.ts) sweeps viewport widths bracketing the glow and, at each stop, wheels horizontally over the column and reads `scrollLeft`. The committed golden records the relation per stop; the widest stop is the control where the glow does not bleed at all.

Two guards keep the scenario honest. The vacuity guard asserts the glow still reaches past the column at the narrow stops, so the claim cannot pass by the symptom having disappeared for an unrelated reason. The mutation control forces `overflow-x: auto` back on in the page and shows the same gesture, at the same timing, carrying the column to its positive scroll boundary; the test measures that boundary directly because a stable scrollbar gutter can leave some overflow on the negative side of the scroll origin. Without the control, a `scrollLeft` of 0 could equally mean the wheel never arrived.

## Consequences

The conversation column no longer offers a horizontal scrollbar at any width, and decorative bleed in the composer chain is now clipped rather than exposed as scroll range. The cost is that genuinely wide content under this column is clipped instead of reachable by scrolling: any such surface owns its own scroller, as the markdown code block and the trajectory table already do.
