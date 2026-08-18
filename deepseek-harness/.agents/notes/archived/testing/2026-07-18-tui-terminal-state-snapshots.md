# Agent Note: Snapshot semantic terminal state for the TUI

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-18-tui-terminal-state-snapshots.zh.md)

## Problem

The TUI is a stateful renderer. Its user-visible result depends on ANSI parsing, differential frames, wrapping, scrollback, viewport position, terminal width, focus, cursor state, and each tool's presentation intent. Unit tests that collect `Terminal.write()` fragments can prove event handling, but they cannot prove the final screen a terminal displays. The same screen may also be emitted through different write fragments, so pinning those fragments creates false regressions.

Component-line snapshots stop before ANSI reaches a terminal and miss cursor movement, clearing, styling, overlay composition, and reflow. Raster screenshots include font and platform rendering noise that is unrelated to the TUI contract. A completed flow built by directly appending plausible session events has another blind spot: it proves the renderer accepts those shapes, not that the production agent loop and tool implementations produce them.

The reusable TUI therefore needs a deterministic, reviewable representation of terminal state. A product deployment that ships it additionally needs recorded model journeys through the assembled stack and a smaller test at the real process and PTY boundary.

## Decision

Reusable TUI coverage has two complementary package layers:

1. `packages/ui/tui/tests/tui.spec.ts` tests event mapping, input routing, disposal, and error behavior directly.
2. `packages/ui/tui/tests/tui.snapshot.ts` mounts the production TUI against a headless terminal emulator for transient states that a completed session log cannot retain: in-flight streaming, pending tool calls, overlays, expansion, compaction reflow, errors, and shutdown.

The [explicit-config entrypoint decision](../simplification/2026-08-03-explicit-config-dsh-entrypoint.md) removed the product TUI composition, recorded application journeys, and PTY suite. A deployment shipping a terminal front door owns those assembled-application layers; package tests do not claim that product coverage.

### Removed application replay

The deleted application suite gave each scenario `session.jsonl`, optional child logs `session.<n>.jsonl`, and `terminal.expected.txt`. The primary log supplied user-authored `user/message` prompts and the recorded `assistant/chunk` sequence. `dsh-llm-replay` derived one model-call script per session and was the only mocked boundary; the agent loop, tools, workers, presenters, and TUI were production implementations.

That suite rejected a journey when its tool-call sequence differed, an expected event count was missing, a tool result was an error, a turn ended in error, a workflow lifecycle was incomplete, or the live child-session count differed from the fixture set. These checks remain the acceptance pattern for any future terminal deployment; they are no longer shipped fixtures.

The removed recording workflow used `DSH_SNAPSHOT=record` for model journeys and `DSH_SNAPSHOT=refresh` for derived terminal output. Removing the product entrypoint also removed those modes from the repository snapshot lane; reusable TUI snapshots are authored directly from package scenarios.

### Semantic terminal projection

The package-local `HeadlessTerminal` implements the same pi-tui `Terminal` interface as the process terminal and feeds every ANSI write into the pinned `@xterm/headless` parser. Snapshot code waits for synchronized frames to quiesce before reading state. The streaming checkpoint freezes the loader interval while allowing real wall-clock delay across one animation tick, so it pins semantic status rather than whichever spinner glyph the scheduler happened to render.

Each expected output projects dimensions, active-buffer and viewport coordinates, lifecycle and cursor state, rows, wrap markers, and non-default style ranges into text. Scroll-heavy cards capture the used buffer; overlays capture the visible viewport. Text and style remain separate so a reviewer can distinguish content changes from presentation changes without decoding ANSI bytes.

Every checkpoint enforces theme independence across the complete terminal state: no RGB colors, no palette entries beyond ANSI 0–15, and no explicit background colors. Reverse video remains valid for selection because it uses terminal defaults. Both suites own closed inventories that reject missing scenarios, missing checkpoints, and orphaned expected output files.

### Required scenario matrix

| Layer | Scenario | Contract pinned |
|---|---|---|
| Transient state | Streaming and pending advanced calls | In-flight reasoning/text plus pending Code Mode, workflow, and Cordis cards that disappear from completed logs |
| Transient state | Cards, interaction, layout, failure, and shutdown | Collapsed/expanded card families, question validation, compaction replacement, resize reflow, help/errors, cursor restoration, and terminal stop |

## Alternatives considered

- **Snapshot raw terminal writes** — rejected because differential rendering may change write boundaries without changing the screen, while cursor and clear sequences are unreadable in review.
- **Snapshot component render lines before terminal output** — rejected because it does not test ANSI parsing, cursor movement, overlays, viewport behavior, or independent components in one frame.
- **Build every completed flow by appending session events** — rejected because a hand-authored event sequence can drift from the agent loop, tool execution, child-session binding, or worker behavior while its presentation test stays green. Direct event construction remains limited to transient renderer states.
- **Reuse ACP stdout expected outputs as the TUI oracle** — rejected because a recorded model journey is transport-neutral but its presentation is not. A terminal deployment owns its expected output while it may reuse the same JSONL replay vocabulary.
- **Commit raster screenshots** — rejected because fonts, glyph metrics, antialiasing, and host terminal themes make them platform-sensitive and make semantic style changes difficult to review.
- **Use only PTY end-to-end tests** — rejected because raw PTY output is a stream of historical drawing operations, not queryable final state. PTY tests retain the real Loader/input/teardown boundary, while the emulator owns broad state coverage.

## Consequences

- Package snapshots fail when TUI event mapping or presentation breaks; they do not substitute for an assembled application's tool-path transcript.
- TUI visual regressions produce readable cell-and-style diffs, while JSONL fixtures retain the exact model chunks that made the production path execute.
- The emulator uses xterm's proposed buffer API. An xterm upgrade requires rerunning and reviewing the semantic projection; terminal-specific behavior still needs a PTY smoke owned by the deployment that ships it.
- Expected outputs deliberately encode wrapping and viewport behavior at fixed sizes. Intentional layout changes update and review the package semantic snapshots.
