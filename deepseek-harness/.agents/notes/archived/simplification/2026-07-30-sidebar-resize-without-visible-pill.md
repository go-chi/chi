# Agent Note: Sidebar resize without a visible pill

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-30-sidebar-resize-without-visible-pill.zh.md)

## Problem

The AppFrame exposed identical floating pills on both column borders. The left pill added unnecessary visual weight beside primary navigation, but the sidebar's resize interaction remains useful.

## Decision

AppFrame keeps the sidebar's 8px resize hit strip, `col-resize` cursor, pointer capture, animation-frame throttling, and width updates, but does not generate the sidebar handle's pill pseudo-element. The details boundary retains both its hit strip and floating pill.

The layout component test continues to pin sidebar dragging and both handles' collapse lifecycle. A keyless browser scenario reads the generated pseudo-elements from the shipped composition and drags the invisible sidebar boundary to prove the interaction remains live.

## Alternatives considered

**Remove the sidebar drag interaction with the pill.** Rejected because the requested change is visual; removing a working geometry control would unnecessarily narrow the interaction.

**Keep the pill but reduce its emphasis.** A smaller or lower-contrast pill still leaves an unwanted object on the sidebar boundary.

## Consequences

The sidebar boundary is visually quiet while pointer resizing remains available from the boundary and retains the resize cursor. Unlike the details control, that interaction has no visible pill.
