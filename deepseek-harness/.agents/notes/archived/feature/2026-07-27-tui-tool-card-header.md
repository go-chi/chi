# Agent Note: Fixed `Tool / <name>` header for tool-call cards

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-27-tui-tool-card-header.zh.md)

## Problem

The TUI rendered each tool call as `{glyph} {title}`, where `title` was the presenter's fused verb-plus-detail string (`Read src/index.ts (1200-1360)`, `Edit files`, or a bash card's model description), bold and underlined in the status color. One flat slot carried the tool identity, the target, and the status at once, and the styling mixed bold, underline, and color inconsistently — the header read as noise, and which tool ran was not visually separable from what it operated on.

## Decision

The header is a fixed `{ring} Tool / <name>` frame in a single flat status color — no bold, no underline, no dim — so one color reads consistently across the whole row. `Tool` is a literal constant; `<name>` is the raw tool name. The separator is ASCII `/`. The ring marker is `○` while the call is pending and `●` once it settles; the header color (warning pending / success ok / error) distinguishes pending from ok from error, so the same filled ring serves both settled states.

The header carries exactly one optional extra: a bash (terminal) card's model-authored description, appended as a ` / <desc>` segment (`● Tool / bash / Run the coverage gate`). No other tool contributes a header detail.

Every tool-specific detail moves into the body block below the header. A non-terminal card's presenter title (`Read src/index.ts`, `Grep pattern`) becomes the first body line, unless it only repeats the tool name (the fallback presenter for a tool with no `presentCall`, or an unknown tool), which the header already shows. A terminal card keeps its command as the `$`-line. A diff card drops its title entirely — the per-file path headers and a change footer carry the meaning — and appends a dim `└ +A -R · N file(s)` footer summarizing added/removed line counts across the files.

The redesign is TUI-only. It touches `ToolCardComponent` in `packages/ui/tui/src/components/transcript.ts` and no presenter: the `Tool / <name>` frame derives the name TUI-side from the call's tool name, and the body-title relocation reuses the presenter title already returned. `presentation.ts` and every `presentCall`/`presentResult` are unchanged.

## Alternatives considered

**Bold the name to make it stand out.** Rejected: on terminals that render SGR-1 as the bright color variant, a bold green name reads as a different color from the rest of the green header — reintroducing the inconsistency the redesign removes. The name stands out by position in the fixed frame, not by weight.

**Keep the presenter title in the header** (e.g. `Tool / read / Read src/index.ts`). Rejected: the verb duplicates the tool name, and non-bash tools have no genuinely distinct one-line description — the target belongs in the body, so only bash contributes a header desc.

**A summary footer for every card type** (line counts, exit pills, diff counts as a uniform `└ …` line). Deferred: only the diff footer shipped. Terminal exit keeps its existing dim `[exit N]` line, long output keeps its existing head+tail middle-elision, an empty result stays header-only, and an error body stays plain (only the header color carries the error) — the current treatments were kept deliberately, not by omission. The body's flat default-foreground styling was later revisited: the [consolidated TUI presentation](../architecture/2026-07-28-consolidated-tui-presentation.md) recesses the whole body into one dim tone under this note's colored status header.

## Consequences

A tool call now shows its identity in one stable place, and status reads as one flat color per row, so a transcript of many calls scans as a column of `Tool / <name>` rather than a wall of mixed-styled verb strings. The cost is one extra body line for non-terminal tools (the relocated title) and the loss of the earlier redundancy-suppression that omitted a diff's per-file path when the header already named it — the header no longer names any path, so every diff prints its path once. Because the change is confined to `ToolCardComponent`, other UI bridges (ACP, JSON-RPC) keep their own tool-call presentation; the `Tool / <name>` shape is TUI-local and not part of any cross-package contract.

## Testing

`packages/ui/tui/tests/tui.spec.ts` pins the new header (`Tool / <name>`), the dropped diff title, the relocated generic title, and the `· N file(s)` footer. Package semantic snapshots cover the card families in a headless terminal. The deleted application journeys formerly supplied assembled tool executions; a future terminal deployment owns equivalent transcript coverage.
