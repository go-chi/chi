# Agent Note: The no-Workspace composer opens the existing picker

Status: implemented

English | [中文](2026-08-07-workspace-picker-composer-entry.zh.md)

## Problem

The [session-scope decision](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.md) keeps one resident composer before a Workspace exists, but its textarea was disabled and only the smaller Workspace chip could open the picker. The largest and most familiar starting affordance therefore rejected the user's first click even though a recovery action was available on the same surface.

## Decision

While no Workspace owns the new Session, the whole composer card activates the existing `conversation.hero.workspace` picker by pointer click — the card owns the click handler and its disabled controls let pointer events fall through, so the full capsule is one target — and the read-only resident textarea does the same by Enter or Space. `aria-haspopup="menu"` and `aria-expanded` describe the shared picker menu while it is mounted. On a fresh installation with no Workspace rows, the picker immediately hands off to the directory dialog and clears its expanded state; that dialog exposes its own accessibility semantics. A dashed l4 stroke (an SVG dash ring, since native `dashed` has a fixed pattern) with a business-blue hover marks the card as the pick affordance. The card contains `pointerdown`, so the open picker's outside-close cannot race the click's reopen — that close-then-open flickered the chip's expansion echo. Message submission, command, permission, model, and other Session-scoped controls remain locked until Workspace selection creates or reconnects a real Session.

Workspace selection retains the existing owner and flow. `ConversationRoot` opens the picker, `WorkspacePicker` lists or creates the Workspace, and the same textarea DOM node becomes the editable composer after the Session arrives.

## Alternatives considered

**Keep the textarea disabled and emphasize the Workspace chip.** This preserves the old control boundary but leaves the dominant composer surface inert during the first action.

**Place a transparent button over the textarea.** A button has direct trigger semantics, but it creates a second focusable element over the resident textarea and complicates the DOM-identity transition that preserves focus, IME, and draft behavior.

**Accept a draft before Workspace selection.** This would require a client-owned draft Session or another pre-Session state axis. The feature only needs a discoverable path into the existing picker.

## Consequences

The first composer click now continues the required setup flow, and keyboard users can activate the same path. The textarea accurately reports read-only state until a Session exists, while adjacent controls remain disabled. The UI introduces no new Workspace state, transport, or directory-selection flow.

Component coverage pins pointer and keyboard activation, the card-wide click target, the contained `pointerdown`, locked adjacent controls, picker expansion, and the same-node transition to an editable textarea. The assembled Web helper begins fresh Workspace setup through the textarea, so replayed browser scenarios exercise the shipped path.
