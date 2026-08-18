# Agent Note: User-message IconActions under the bubble

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-27-user-message-icon-actions.zh.md)

## Problem

The chat user bubble had no under-bubble action chrome. The Harness design (figma `User_Bubble/message_container`) shows three IconActions — copy, branch in new chat, and edit — right-aligned under the bubble, matching the product action-bar pattern used elsewhere.

## Decision

`MessageItem` owns the actions for `kind: 'user'` only. Layout is a column (`align-items: flex-end`, 6px gap): bubble, then a 28px action row with 10px gaps and 28px circular icon buttons (`IconCopyOutline16`, `IconBranchOutline16`, `IconEditOutline16`). Tooltips carry Chinese labels. Actions stay visible by default; `@media (hover: hover)` hides them until the row is hovered or focus-within, so touch / `hover: none` devices keep discoverable controls (opacity alone still hit-tests).

Copy writes the bubble's joined text blocks to the clipboard (`navigator.clipboard.writeText`, with an `execCommand` fallback). Branch and edit are present chrome with no handlers yet — they reserve the design seats without inventing session-fork or edit-resubmit behavior.

Steering bubbles keep the badge-only form and do not show these actions.

## Alternatives considered

**Wire branch/edit to real session fork and draft-edit now.** Rejected for this change: those product flows are not specified; shipping inert buttons matches the requested scope and avoids half-built mutation paths.

**Always hide with `opacity: 0` outside hover.** Rejected for touch: without `@media (hover: hover)`, idle opacity still hit-tests while looking empty. Hover-capable pointers keep the fade; others keep the actions visible.

## Consequences

User messages expose copy immediately; branch/edit remain clickable stubs until a later decision owns their behavior. Tests pin the three buttons, copy payload, and steering exclusion.
