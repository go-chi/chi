# Agent Note: Creator guidance lands as an introduce cue on the preset chip

Status: implemented

English | [中文](2026-08-10-creator-guidance-introduce-cue.zh.md)

## Problem

Authoring a preset happens inside a Creator-mode session, but the settings section gave no path into that fact. The creator entry sat outside the roster groups, the custom group vanished entirely while it had no member, and clicking the entry dropped the user onto the new-session screen with nothing marking what had changed: the staged preset chip rendered exactly as if the user had picked it by hand. Users reported not understanding that the flow had moved, or that the session they were about to start was the place where the preset gets built (#2184).

## Decision

The custom group stays on screen while empty — heading plus the creator entry, which lives inside the group as the standing "your preset will appear here" affordance rather than floating below the roster.

A pick staged from another screen carries a one-shot `introduce` flag through the seat store (`stage(id, introduce)`), and the chip announces it: the preset icon eases in over 150ms, then the name's characters fade up on a stagger the moment the icon lands. The stagger is capped twice — 40ms per tick for short CJK names, and one shared 200ms reveal window (`min(40, 200/(n-1))`) so a long Latin name finishes in the same time as its CJK counterpart instead of dragging the run out per character. CSS owns the motion; the component arms it and acknowledges the cue once the run is over, so the flag never replays on a later mount. `prefers-reduced-motion` and an empty display name acknowledge immediately with no run.

The cue is pure presentation: it is client-side seat-store state, never a session event, because the model-visible composition is already carried by the staged preset itself.

## Alternatives considered

**A toast or callout on the new-session screen.** It explains more, but it points at nothing — the chip is the artifact the user must find again later, and a dismissable box teaches the box, not the control. The cue puts the motion on the control itself.

**A fixed per-character tick.** The first implementation used 60ms per character unconditionally; an English preset name took over three times as long as its four-character Chinese counterpart, reading as lag rather than emphasis. The shared reveal window makes duration a property of the cue, not of the locale.

**Animating the pick inside the settings dialog before leaving.** The dialog closes as part of the gesture — leaving settings is how the flow says the work happens in the session — so anything played there would be cut off or would delay the navigation it exists to explain.

## Consequences

The intro timeline lives in two places that must agree: the component's `INTRO_TEXT_DELAY_MS` and the `.introIcon` CSS animation duration. The component's constants are the source of the character delays and the acknowledgement timeout; the CSS comment names the coupling. The seat store gains one bit of UI state (`introduce`) that every stage decides explicitly, and the section keeps rendering a group with no members — a shape the section golden and unit tests now pin.

## Testing

Component tests pin the capped stagger (11-character Latin name at 20ms steps, 4-character CJK name at the 40ms tick, single character with no stagger), the acknowledgement timing, and the reduced-motion and empty-name skips. `apply.spec.ts` drives the cross-screen stage end to end: the creator draft stages with the cue set, one acknowledgement clears it, and a repeat acknowledgement leaves the snapshot untouched. The `agent-preset-authoring` web e2e holds the empty custom group (heading plus creator entry) in its goldens.
