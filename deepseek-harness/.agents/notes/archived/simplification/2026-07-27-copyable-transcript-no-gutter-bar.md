# Agent Note: Copyable TUI transcript without gutter bars

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-27-copyable-transcript-no-gutter-bar.zh.md)

## Problem

The TUI grouped user prompts and tool cards behind a colored left-gutter bar (`▌ `) prepended to every body line, and indented assistant and system blocks by one column. Both are per-line prefixes: a terminal mouse drag-select over the scrollback captures the leading `▌ ` or the leading space on each line, so copy-paste of a message, a tool's output, or a code block pulls in decoration the user must strip by hand. The bar was the transcript's only per-message separator, so it could not simply be dropped without another way to tell messages apart.

## Decision

The scrollback carries no per-line prefix. Messages are separated only by a bold, underlined role header in the role color and blank-line spacing, both of which the terminal already inserts around each block. The underline gives each role a distinct visual band without a background fill, so it reads on any terminal theme and never enters the clipboard:

- User and steering prompts (`UserMessageComponent`) are a plain `Container`: a bold, underlined accent `You` / `Steering` header line (via the shared `messageHeader` helper), then the prompt body at column 0.
- Assistant blocks render a bold, underlined `Assistant` header, then reasoning and text at column 0, with the timing line at the end of the block (the former `paddingX = 1` indent is gone).
- Tool cards drop the `GutterBox` wrapper. The card status (pending / error / success) colors the whole title line — the status glyph (`◌` / `✕` / `✓`) plus the title text share one color, bold and underlined to match the role headers — instead of a colored bar beside an uncolored title. The body renders unprefixed; body lines still pass through `Text` at the terminal width so overlong raw tool output wraps rather than overflowing.
- The `GutterBox` class is deleted; nothing else used it.

A drag-select over any of these regions now copies exactly the message text.

## Alternatives considered

- **Keep the bar only on user messages, drop it on tool cards** — leaves tool output, the most-copied region, still polluted. Rejected: the goal is a wholly copyable transcript.
- **A single top rule or bar on the header line only** — the body copies clean, but selecting the header still captures a glyph, and it reintroduces a decoration character for no distinguishing gain over the underlined role header.
- **Indent grouped bodies instead of a bar** — leading spaces still enter the clipboard, so it does not solve the copy problem; explicitly ruled out.
- **A filled background band on the header** (reverse video, or a 256-color muted background) — gives each role a strong color block, but the saturated ANSI fill reads as too heavy and the 256-color shades are fixed rather than theme-remapped. The underline gives per-role distinction with a far lighter footprint.

## Consequences

- Copy-paste from the scrollback is clean with no user post-processing. This was the motivating win.
- The transcript is flatter than the gutter-bar layout, but each role's bold, underlined header in the role color plus blank-line spacing keeps message boundaries clear without any left-edge fill. Tool-card status stays legible through the colored, underlined glyph and title.
- Box-drawing borders (`│`) on transient overlays — status panel, model selector, resume list — are untouched. They are not scrollback message content and are rarely copied.
- The affected keyless TUI `*.expected.txt` snapshots were re-recorded by fixture replay (no API key needed; the recorded LLM sessions are unchanged, only the render differs). Interactive boot and a round-trip prompt were verified in tmux.
