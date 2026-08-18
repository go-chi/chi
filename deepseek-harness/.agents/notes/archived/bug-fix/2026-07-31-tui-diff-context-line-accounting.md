# Agent Note: TUI diff context lines stay neutral

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-31-tui-diff-context-line-accounting.zh.md)

## Problem

Result-time filesystem diffs carry the applied change with three surrounding context lines in each `FileDiff.oldText` and `FileDiff.newText`. The TUI rendered every old-side row as removed and every new-side row as added, including the identical context present on both sides. A one-line edit therefore appeared as seven removals plus seven additions, and the footer repeated those inflated totals.

## Decision

The TUI compares each `FileDiff` whose old and new text are both available. Added and removed rows retain their green `+` and red `-` markers; equal context rows use the recessed body tone with a neutral two-space prefix. The footer sums only the rows classified as added or removed. `maxDiffEditLength` bounds the exact comparison by its combined added and removed line count; the default is 1000. Exceeding the bound renders the complete old side as removed and the complete new side as added, marks the footer approximate, and caches that result so redraws do not repeat the comparison. A tool result clears the pending-view cache before deriving the settled view, including when a presenter mutates and reuses the same view object.

When `oldText` is `null`, the renderer cannot distinguish a create from a pending overwrite or an argument fallback whose prior text is unavailable. It therefore shows every non-empty new-side row as added, without claiming those rows were absent from an existing file. Empty new content renders no synthetic added row.

This remains a consumer-side interpretation of the existing `FileDiff` contract. Filesystem tools continue to persist contextual before/after snippets, so other consumers keep their placement context and existing session logs replay with corrected TUI presentation. The TUI uses the same maintained `diff` package as `dsh-tool-fs` instead of introducing a second line-diff implementation.

## Alternatives considered

**Remove context from filesystem result metadata.** Rejected: contextual applied hunks are intentional producer output used by capable editors, and changing them would weaken every consumer while leaving old session logs misleading in the TUI.

**Extend `FileDiff` with persisted per-line tags.** Rejected: the tags can be derived deterministically from the existing before/after pair; persisting them would widen the cross-package and session-log contract solely for one renderer.

**Match equal lines by position without a diff algorithm.** Rejected: insertions and deletions shift subsequent context, so positional pairing would misclassify valid hunks.

**Run every comparison to completion.** Rejected: pending tool views can contain unrestricted model-authored old and new strings, and an unbounded Myers comparison can block the synchronous terminal renderer.

## Consequences

TUI diff cards distinguish evidence-bearing context from the mutation itself, and an exact `+A -R` footer reports the actual line delta. Replaying an existing contextual diff gains the corrected rendering without a migration. Result-time filesystem hunks are context-bounded; unrestricted pending views either complete within the configured edit-length budget or degrade to an explicitly approximate linear rendering.

The focused TUI tests cover neutral context, exact totals, an empty create, bounded fallback, result-time cache invalidation, and redraw cache reuse. The assembled `advanced-cards` terminal snapshots pin the neutral context style, semantic change colors, exact footer, and approximate fallback through collapsed and expanded card states.
