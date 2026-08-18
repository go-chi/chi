# Agent Note: Collapsible Ask-User Question Card

Status: implemented

English | [中文](2026-08-11-collapsible-ask-user-question-card.zh.md)

## Problem

`dsh`'s ask-user takeover renders the pending question set as a bottom card capped at `min(60vh, 520px)`, so a long batch or a user who wants to re-read the conversation above before deciding has no way to reduce the card — the conversation above becomes hard to read because only a few lines peek out at the top.

## Decision

Add a minimize/maximize toggle to the question card header, next to the existing dismiss action. Collapsing hides the option body and the footer actions, leaving a header strip (eyebrow, title, both icon buttons) so the user still sees that a question is pending; expanding restores the full card.

- State lives in `QuestionFlow` local state (`minimized`), so drafts and the current question index survive collapse/expand — nothing is re-derived or reset, and the answers already picked remain submit-ready.
- The toggle is a plain `IconChevronDownOutline14` / `IconChevronUpOutline14` pair on the existing 24px icon-button grid; `aria-expanded` reflects the card state and the label flips between `nav.minimize` / `nav.maximize` (the collapsed button reads "expand" for screen readers).
- While minimized the option body and footer are unmounted (`{!minimized && ...}`), so no hidden interactive surface remains in the a11y tree.
- The collapse button is disabled while a submit/cancel is in flight (`busy !== null`), matching the dismiss button's existing guard.
- CSS: `.cardMinimized` drops the `max-height` cap and hides `.body` / `.footer`; `.header` gains bottom padding so the strip is not cramped.
- Scope: only the generic question flow (`QuestionFlow`) gets the toggle. The plan-review card (`PlanReviewPanel`) is a different shape (one decision over one plan) and keeps its current layout.

## Consequences

- Users can shrink the question card to read the conversation, then expand to answer — drafts and position are preserved because the state lives in the flow component, not in the DOM.
- The minimize action is visually adjacent to dismiss; both share the icon button style, so the header stays balanced.
- Product copy additions are confined to the `question` locale namespace (`nav.minimize` / `nav.maximize`), paired zh/en per the dictionary contract.

## Alternatives considered

- **Auto-collapse on scroll**: collapsing the card when the user scrolls the conversation would reclaim space without a button, but it fights the user mid-interaction and hides the pending-question signal unexpectedly; an explicit toggle keeps the decision with the user.
- **Resizable card**: a drag handle would let users size the card freely, but it is more machinery than the ask needs and does not address "I want the card out of the way entirely".
- **Persisting the collapsed state per session**: nice-to-have, but the ask is per-interaction; persisting adds storage and sync complexity without a clear win for this surface.
