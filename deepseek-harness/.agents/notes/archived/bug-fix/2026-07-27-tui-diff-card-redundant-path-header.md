# Agent Note: TUI diff card dropped the duplicated file path

Status: implemented
Archived: 2026-07-31

English | [中文](2026-07-27-tui-diff-card-redundant-path-header.zh.md)

## Problem

The `edit` and `write` tool cards printed the target path twice. Each tool's `presentCall`/`presentResult` returns a diff card whose title is `Edit <path>`/`Write <path>` and whose single `FileDiff` carries the same `path`. The TUI's `diffLines` unconditionally rendered `palette.bold(diff.path)` as a per-file header, so a one-file edit rendered:

```
✓ Edit src/foo.ts
src/foo.ts
- old
+ new
```

The existing snapshot fixture hid the bug: it titled the edit card `Edit renderer` (no path) and gave the result two diffs, so the title never matched a diff path and the header never looked redundant.

## Decision

`diffLines` takes a `showPath` flag; `ToolCardComponent.renderBody` suppresses the per-file header for a diff card when there is exactly one diff and the effective card title (`resultView?.title ?? callView.title`) already contains that diff's path. Multi-file diff cards keep every per-file header. An empty or blank diff path collapses under the same `String.includes` check, which is the intended noise removal.

The suppression lives in the TUI renderer, not in each tool's presenter, because the redundancy is a presentation concern shared by every current and future single-file diff card; the tools keep emitting the path in both the title and the diff so non-TUI consumers still get it.

## Alternatives considered

- Drop the path from the `edit`/`write` card titles. Rejected: the title is the scannable summary line; removing the path weakens it, and it would have to be repeated per tool.
- Always drop the per-file header. Rejected: multi-file result diffs (and any future multi-file diff card) genuinely need per-file headers.

## Consequences

The heuristic is a substring match, so a title that happens to contain a single diff's path suppresses the header even if the match is incidental; for the real producers the title is exactly `Verb <path>`, so this is correct in practice. The snapshot `edit` fixture now mirrors production: one diff whose path the title names, proving the header is dropped, while multi-file header retention is covered by the `tui.spec.ts` `edit` fixture (`a.txt`/`b.txt` under an `Edit files` title).

## Testing

`tui.spec.ts` adds a focused case asserting the path appears exactly once for a single-diff card titled `Edit src/only.ts`. The `advanced-cards-*` keyless snapshots re-recorded to show the title line immediately followed by the diff body with no repeated path header.
