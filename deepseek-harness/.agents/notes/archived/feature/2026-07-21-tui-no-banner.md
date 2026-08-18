# Agent Note: No startup banner

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-tui-no-banner.zh.md)

> **Superseded** by the [borderless-banner Agent Note](2026-07-21-tui-borderless-banner.md): the banner and its sweep return without the box. The model's footer home this note added stays.

## Problem

The TUI opened with a boxed product banner ("DEEPSEEK HARNESS" + model/session detail), most recently with a sweep-in animation ([banner sweep Agent Note](2026-07-21-tui-banner-sweep.md)). The user's verdict: remove it. A product title re-read on every boot is chrome, the box spends four rows before any content, and the identifying facts it carried (model, session) have better homes.

## Decision

- `HeaderComponent`, the sweep animation, and its lifecycle wiring are deleted. The TUI mounts straight into the transcript; startup renders nothing above the separator.
- The model name moves into the footer status line's left segment (`<model>  <cwd>  ↑tokens ↓tokens`), so the session's driving model stays visible at all times, not just at boot. The session id is no longer displayed — it lives in the session log and `./.sessions` filenames, where `dsh --resume <id>` and the `/resume` selector retrieve it.
- `welcome`, when configured, renders as the transcript's first line (a muted notice) inside `rebuildTranscript`, so palette swaps preserve it. Unset renders nothing. Fixtures keep their configured welcomes; the PTY smoke's boot marker becomes the footer's model name, the only mounted-TUI text guaranteed to render regardless of cwd length.

This supersedes the [banner sweep Agent Note](2026-07-21-tui-banner-sweep.md) entirely: both the sweep and the banner it animated are gone.

## Alternatives considered

**Keep a one-line header (no box).** Rejected: the only load-bearing fact was the model name, and the footer already aggregates session status; a dedicated header row for one fact is the same chrome, smaller.

**Show the session id in the footer too.** Rejected: a 36-char UUID dominates the 100-column footer and clips the status segment; it identifies the session for resume, which is a log/filesystem concern, not a glanceable one.

**Print the welcome outside the transcript (above the separator).** Rejected: any fixed region above the transcript is a banner again; as a transcript line it scrolls away naturally and survives rebuilds through the same path as every other transcript element.

## Consequences

- Startup output is fully deterministic again — no animation frames at all; the interval-lifecycle machinery from the two animation iterations is gone.
- All 26 pi-tui terminal snapshots re-recorded (`test:snapshot:refresh`): banner rows gone, footer rows gain the model prefix.
- Anything that anchored on banner text (`DEEPSEEK`, box corners) re-anchors on the footer model name; `main-session-` no longer appears in boot output.
- `/clear` now wipes the welcome line too: it is an ordinary transcript line, and `/clear` empties the transcript (the old banner survived `/clear` only by sitting outside it).
- The footer's left segment is wider; on narrow terminals the right status segment clips earlier.

## Testing

`packages/ui/tui/tests/tui.spec.ts` pins: no box corners/product title and an empty transcript when `welcome` is unset, with the model in the footer; a configured welcome as the first transcript line without a banner; and the welcome surviving a palette-swap transcript rebuild. The PTY smoke boots on the footer model name and asserts `DEEPSEEK HARNESS` is absent. Snapshots verify the full frames.
