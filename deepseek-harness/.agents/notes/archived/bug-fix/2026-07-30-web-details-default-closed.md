# Agent Note: Web details default closed

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-30-web-details-default-closed.zh.md)

## Problem

The transient layout store initialized details to its 360px contract width. The first connected Session and every full reload therefore reserved a right column before the user selected any detail content. Chat tool rows deliberately remain inline and do not open details, while Trajectory rows open the panel when an event is selected, so an open layout default did not represent an active detail selection.

## Decision

The layout store initializes details to zero while retaining the existing 360px contract default for `openDetails()`. `AppFrame` keeps the details slot mounted at zero width, so an explicit entry point such as Trajectory event selection can open the panel without remounting its subtree. The [Session ownership lifecycle](2026-07-29-web-details-session-lifecycle.md) remains authoritative: unselected surfaces derive zero width without taking ownership, returning to the same Session preserves an explicitly opened width, and selecting a different Session closes it.

Panel geometry remains transient. No browser storage key is introduced, and reload restores the sidebar default while details returns to zero. Component tests pin the store default, mounted zero-width slot, drag and concession behavior after explicit opening, and Session ownership transitions. The keyless shipped-composition regression pins the closed first Session, reload, new-session surface, and subsequent Session selections.

## Alternatives considered

**Persist the last open or closed preference.** Rejected because reload should have a deterministic closed baseline, and persisting geometry would reintroduce stale viewing state across browser sessions.

**Keep details open until Chat receives a replacement selection gesture.** Rejected because empty space is not useful detail content. Chat's inline tool-row interaction and any future detail-selection gesture are separate product decisions.

**Remove the details column and layout service.** Rejected because Trajectory already opens event details through this seam, and keeping the mounted slot preserves that working interaction.

## Consequences

New, restored, and reloaded Sessions use the full center area until an explicit details action opens the right column. Trajectory event selection can still open details at 360px and its close control returns the track to zero; Chat tool rows remain geometry-inert. Switching to another Session closes an opened panel, and no panel state survives reload.
