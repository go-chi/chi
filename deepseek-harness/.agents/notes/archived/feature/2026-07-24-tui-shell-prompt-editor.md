# Agent Note: TUI shell-prompt editor

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-24-tui-shell-prompt-editor.zh.md)

## Problem

The upstream pi-tui editor always renders horizontal frame rows. That presentation separates input from the transcript but occupies two terminal rows and does not resemble the command-oriented input used by shells.

## Decision

The TUI presents a two-line prompt. A DSH-owned context line shows the working directory, running-turn timing, optional Git branch, current model, token totals, cache hit rate, and context pressure as independently prioritized segments. Narrow terminals omit lower-priority segments while retaining the directory, followed by running timing when it is present. The second line uses a fixed-width `dsh> ` prefix and equal-width continuation indent; its running steer/cancel guidance is placeholder text that disappears when input begins.

The pinned `@earendil-works/pi-tui` package carries a pnpm patch that adds `frame: "none"` and fixed-width prompt prefixes to `EditorOptions`. The default remains the upstream horizontal frame, so only the DSH editor opts into the behavior. Prefixes must have equal visible widths; construction fails when they differ. Input, explicit newlines, autocomplete, cursor placement, and scroll indicators share the reduced first-row width; automatically wrapped rows render no prefix, so their text starts at the editor's left padding, occupies the prefix columns, and wraps at the full content width.

The patch stays limited to the published editor JavaScript and declarations. Keeping the exact dependency pin makes installation either apply the known patch or fail rather than silently dropping the presentation.

## Alternatives considered

**Filter the rendered editor output in a wrapper.** This would depend on recognizing ANSI-styled border and scroll-indicator rows and distinguishing autocomplete output from input output, all of which are undocumented render details.

**Vendor the complete pi-tui package.** The project updates frequently, while this change needs only a localized editor rendering option. Owning the full source and synchronization process would add disproportionate maintenance.

**Keep the horizontal frame.** This avoids dependency customization but retains the presentation the change is intended to replace.

## Consequences

The editor and context use two rows instead of the framed editor plus footer, with one blank row separating the prompt area from conversation cards. The persistent presentation omits session identity and tool-card mode; `/status` and commands retain those details. Input layout and autocomplete lose six columns to the prompt prefix, but wrapped text uses the otherwise blank prefix columns. Borderless scrolling uses standalone `↑ N more` and `↓ N more` rows.

The internal segment representation establishes width priorities without exposing a public customization language. Future Starship-like configuration can build on it after the default modules and overflow behavior have production evidence.

A pi-tui upgrade requires reviewing and reapplying or retiring the patch. TUI terminal snapshots pin the assembled presentation, including context modules, prompt color, alignment, cursor placement, and autocomplete width.
