# Agent Note: Hover cards copy their primary value on activation

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-31-hover-card-click-copy.zh.md)

## Problem

Workspace and Session rows clip the two values their hover cards expose in full: the Workspace directory path and Session title. The [reachable card](../bug-fix/2026-07-30-hover-popup-pointer-grace.md) permits text selection, but selecting and copying a single known value is a needlessly precise gesture, and the card gives no confirmation that the clipboard accepted it.

## Decision

`HoverCard` accepts an optional `copyText` plus `copyLabel` and `copiedLabel`. With `copyText`, the whole card has button semantics for pointer and keyboard activation; its accessible name combines the localized action prefix with the exact value, it writes that value through the shared clipboard helper, and it replaces its content with the success label for up to one second only after the host accepts the write. The feedback retains the pre-copy card height and clears with the card. Without `copyText`, the atom retains its read/select-only behavior.

The Workspace browser chooses the payload rather than making the primitive infer it from rendered text: a Workspace card passes the full directory path, and a non-blank Session card passes the full display title. A provisional blank New Session card remains read-only because its localized label is a placeholder, not session content. The browser's locale seat supplies `Copy`/`复制` and the success state `Copied`/`已复制`.

Press and activation remain separate contracts. A pointer press inside the card keeps it mounted so text selection can begin; a completed non-collapsed selection intersecting the card suppresses pointer-click activation, while a plain click or button key activates copy. Anchor-region presses still dismiss immediately, and clipboard rejection leaves the original content visible without claiming success.

## Alternatives considered

**Copy the card's rendered `textContent`.** That would concatenate the primary value with creation time or running status, making the clipboard payload depend on presentation and localization.

**Implement clipboard state in both Workspace card bodies.** The two consumers would duplicate host fallback, keyboard behavior, timer ownership, and success rendering even though the card owns the activation surface.

**Change the common Chinese `copied` label from `复制成功` to `已复制`.** That would alter every existing copy control to satisfy one card interaction. The Workspace dictionary owns the card-specific wording instead.

## Consequences

Both non-placeholder hover-card variants gain the same click and keyboard affordance while retaining consumer-owned payload semantics and localized feedback. The generic atom adds one optional behavior path and a one-second timer; it clears copied state on close, ignores completion after close or unmount, and never reports a rejected write as success. Focused component coverage pins pointer selection precedence, activation, failure, feedback geometry and expiry, and cleanup, while the real-browser Workspace scenario verifies the English label, stable feedback height, and browser clipboard.
