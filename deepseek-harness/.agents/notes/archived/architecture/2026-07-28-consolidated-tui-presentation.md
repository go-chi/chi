# Agent Note: Consolidated TUI presentation and navigation

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-28-consolidated-tui-presentation.zh.md)

## Problem

The terminal UI accumulated independent presentation rules that interacted poorly: palette roles aliased one another or inverted emphasis on light terminals; tool-card framing, output, and exit markers repeated or competed; injected context was parsed as XML and could not fold reliably; and `/resume` excluded sessions outside the current workspace even when the launcher could reach them. Each symptom appeared local, but the durable decision is one terminal-reading model: a small inspectable palette, status-led cards with recessed bodies, content-independent transcript folding, and workspace-aware navigation.

## Decision

### Palette

`paletteSpec(scheme)` is the single table of SGR codes, close codes, and purposes. `createPalette` derives every wrapper from it and `/palette` prints the same table in the running terminal. Components do not emit their own SGR sequences except for the fixed startup brand gradient. Every close resets every SGR group its open sets.

Duplicate roles are merged: `muted` into `dim`, `added` into `success`, `removed` into `error`, and the unused second accent is removed. `dim` uses `2;39` and closes with `22;39` on both schemes so recessed text stays relative to the terminal foreground rather than becoming a fixed heavy gray on light backgrounds. Colors and attributes are branded separately in TypeScript, allowing attribute/color composition while rejecting nested colors whose reset would discard the outer color.

### Tool cards

A tool card has one colored `Tool / <name>` status header over one dim body. Presenter titles, terminal commands and cwd rows, output, XML text, and fold markers use that body tone. Diff colors remain because red and green carry meaning, and signal markers remain errors.

`renderUnknownXml` receives an explicit body styler for unknown tool results. Terminal presenters parse and remove the model-facing final exit or signal marker before returning `TerminalResultView.output`; the TUI renders the structured status once as its own pill. Truncation, timeout, and sandbox lines remain in the body because the pill does not represent them.

### Injected context and folding

Injected context renders as prose in `ContextCardComponent`, not through the XML tree renderer. Exact matched outer `<system-reminder>` lines are stripped, but mismatched, unpaired, or inline tag-like text remains verbatim. Model-facing content is unchanged. Folding uses the shared `preview` helper after body assembly, so it depends only on row count, never parser success or payload characters.

`Ctrl+O` cycles collapsed, expanded, and hidden. Tool cards disappear in the hidden state together with their card-owned leading gap. Context cards participate in collapsed and expanded states but fall back to collapsed while tools are hidden, because injected instructions are not disposable tool traffic. The hidden phase additionally folds each turn's assistant steps into one message; the [hidden-mode assistant fold Agent Note](../feature/2026-07-29-tui-hidden-mode-assistant-fold.md) owns that rule.

### Cross-workspace resume

The resume picker summarizes all records and owns a current-workspace/all-workspaces scope toggled with Tab. It defaults to the current workspace, adds workspace labels only in the broader scope, and refuses records without a cwd because there is no directory to enter.

`TuiResumeHost.handoff` receives the selected `SessionId` and the cwd re-read during preflight. The CLI changes directory before disposing the current app, so an unreachable directory fails while the terminal can still recover; `execve` then inherits the selected workspace. The launcher also supplies the exit message rather than asking the TUI to reconstruct launcher syntax.

## Alternatives considered

**Keep separate notes and local fixes for each visual symptom.** Rejected: the decisions share one reading hierarchy and repeatedly superseded each other. One owner makes the final palette, card, context, and navigation rules clear without requiring readers to reconstruct chronology.

**Keep aliases and enforce presentation by convention.** Rejected: aliases imply distinctions that do not exist, and nested color resets or incomplete SGR closes fail silently. A single table plus types makes the contract inspectable and mechanically checked.

**Retain framing/output color splits inside tool cards.** Rejected: real cards mixed default foreground, cyan commands, dim cwd, unstyled XML, and dim output. The status header already provides the scan anchor; one recessed body removes noise. Diff colors are the narrow semantic exception.

**Parse or repair injected context as XML.** Rejected: reminder frames are prompting conventions around arbitrary prose containing raw ampersands, comparisons, and placeholder angle brackets. Repairing or escaping it would either guess structure or alter model-visible text.

**Hide context cards with tool cards.** Rejected: context carries injected instructions, not recoverable execution detail. The hidden phase therefore removes only tool traffic.

**Keep resume restricted to one workspace or infer cwd after boot.** Rejected: the restriction forces manual relaunch, while restored header cwd does not control filesystem and shell resolution. The target directory must cross the host seam before process replacement.

**Drop the TUI exit pill or remove model-facing exit markers.** Rejected: the pill is the scannable UI status, while the text marker is the model's status signal. The presenter consumes the marker when constructing the structured view so both audiences receive one representation.

## Consequences

The transcript reads as colored status headers over recessed detail, context presentation is stable for arbitrary prose, and one shortcut controls transcript density. The public `TuiTheme.muted` role is removed; extensions use `dim`. The palette and `renderUnknownXml` contracts are stricter, adding small compile-time friction in exchange for preventing silent style loss.

Cross-workspace resume can move every path-resolving tool to another directory. A missing or inaccessible cwd prevents handoff. The broader picker also makes concurrent access to a shared session store easier to reach; cross-process session locking remains separate work.

The terminal presenter still treats a final output line exactly matching its exit-marker grammar as structured status, so a command that intentionally prints such a line can lose it from the card body. This residual is documented by `dsh-tool-bash`.

## Testing

TUI unit and keyless terminal snapshots cover palette enumeration, light/dark roles, legal and illegal style composition, uniformly dim card bodies, semantic diff colors, marker-free terminal output with one exit pill, prose-preserving context frames, content-independent folding, the three-state Ctrl+O cycle, model filtering, and both resume scopes. CLI handoff tests cover passing the re-read cwd and rejecting directory-entry failure before teardown. Tool-bash tests pin result-marker emission, parse, and stripping as one round trip.
