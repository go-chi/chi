# Agent Note: Tool-card single-row fields render inline

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-27-tool-card-single-row-fields-inline.zh.md)

## Problem

A tool card's title, description, cwd, and pending `$ <command>` echo are each one logical row. The bash tool sets the card title (and description) directly from the model's command and description, which for a multi-line bash script contain real newlines. These fields were escaped with `displayText`, which deliberately preserves `\n` as structural layout. A multi-line title therefore broke onto extra terminal rows that the card's line accounting did not reserve, so the title's later lines overwrote the description, the output, or the editor's steering hint — the card rendered as garbled, overlapping text. Removing the gutter bar (see the [copyable-transcript note](../simplification/2026-07-27-copyable-transcript-no-gutter-bar.md)) made the collision visible because those rows no longer sat behind a per-line prefix.

## Decision

Single-row card fields use `displayInlineText` (which escapes `\n` to the literal `\x0a`) instead of `displayText`: the card title, the terminal-card `description` and `cwd` meta rows, and the pending `$ <command>` echo. Each stays on exactly one row, so a multi-line command can no longer break rows and collide with adjacent lines. Genuinely multi-line fields — captured command output and the `contentText` result body — keep `displayText` plus `split('\n')`, because those legitimately occupy multiple rows.

## Alternatives considered

- **Strip newlines from the presenter output** (in the bash tool) — hides the model's real command shape from any consumer of the view, and pushes a UI concern into the tool. The escape belongs at the single-row render site.
- **Let the title wrap to multiple rows deliberately** — a card title is a one-line identity; a wrapped multi-line title still collides with the following meta rows unless the whole card is re-laid-out, and it bloats the transcript.

## Consequences

- Multi-line bash commands render as a single inline title (`S=/tmp\x0aecho …`); the description, output, and exit rows below stay intact. Verified live in tmux for both the pending (`◌`) and completed (`✓`) states.
- A `multilineTerminal` tool-card case in `tui.spec.ts` asserts the inline-escaped form appears for a newline-bearing title and description.
