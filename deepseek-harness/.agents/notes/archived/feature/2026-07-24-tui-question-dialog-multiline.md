# Agent Note: TUI QuestionDialog renders options across multiple lines

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-24-tui-question-dialog-multiline.zh.md)

## Problem

`ctx.userInteraction.ask()` must keep question text, supporting `detail`, option labels, descriptions, validation, and controls readable inside configured width and height bounds. The question panel also belongs directly above the editor: placing it at the terminal edge separates the pending decision from both the transcript that prompted it and the input that follows it.

## Decision

The TUI renders a pending question as an inline modal between the transcript/status area and the editor while retaining the shared FIFO with model and plugin overlays:

- `InlineModalComponent` applies `questionDialogWidth` and `questionDialogMaxHeight` inside the normal component flow. The effective question height is additionally clamped to the current viewport after reserving the editor, so the editor remains below the question during resize.
- `renderOptionBlock` wraps each label beneath its cursor/number prefix and renders the muted description on separately wrapped, equally indented lines. The progress header, question, custom-answer hint, validation text, and final rows are width-bounded as well; the final ellipsis clamp is only a safety boundary for prefixes or other indivisible content. The explicit `↑ N lines hidden` fallback is reserved for a viewport below the configured minimum, where the whole semantic layout cannot fit.
- When question text or `detail` exceeds the header allocation, the header becomes a paged line viewport with its own `… lines A-B/N • PgUp/PgDn` status row. Page Up and Page Down traverse both line viewports: forward navigation exhausts the header/detail pages before entering oversized selected-option pages, and backward navigation reverses that order. This keeps plan-review detail reachable rather than leaving it behind the height clamp.
- The option-line budget subtracts padding, header, position, and footer rows before `windowBlocks` runs. The window obeys both `maxQuestionOptions` and the remaining row budget, keeps the selected option visible, and renders omitted options as `↑ N more` / `↓ N more` markers. If fixed chrome would leave fewer than four option rows, the compact header becomes the line pager so selected content, paging status, and both option markers still fit.
- When one selected block exceeds its allocation, it becomes a line viewport with a `lines A-B/N • PgUp/PgDn` status row. Page Up and Page Down expose every wrapped line without allowing the block to hide the option markers, validation, or controls.

Package tests pin count and height bounds, header and selected-block paging order, narrow-width wrapping, selection behavior, and placement relative to retained editor input. Semantic TUI snapshots pin the assembled terminal layout, header/detail and selected-option page transitions, and validation state.

## Alternatives considered

**Ellipsis-only horizontal truncation.** Keeping one option per row would signal lost text without making the description readable and would not address vertical bounds. The implementation wraps readable content and retains an ellipsis only as a final safety boundary.

**Wrap the combined label and description.** A composite row couples their widths, so either side can starve the other. Separate lines keep both widths predictable.

**Keep the question as a bottom-edge overlay.** A terminal-edge anchor can place the panel after the editor or cover lower chrome, depending on transcript and viewport height. The inline modal preserves ordering while the modal manager retains focus and FIFO ownership.

**Push the bounds into pi-tui.** Generic overlay slicing cannot identify option boundaries, selected content, controls, or the inline editor relationship. The owning dialog therefore applies semantic count, row, and paging rules.

**Use only the option-count cap.** `maxQuestionOptions` remains a public count bound, but it cannot contain wrapped blocks by itself. The dialog enforces the count and row bounds together.

## Consequences

- Descriptions consume additional rows, so fewer options can be visible than `maxQuestionOptions`; markers state the omitted option counts.
- Long question text and plan-review detail remain reachable inside a height-bounded panel, at the cost of sharing Page Up and Page Down with selected-option paging.
- An oversized selected block reserves one status row and requires Page Up or Page Down to read beyond the current line page.
- The inline question can displace older transcript rows from a short viewport. Below the configured minimum height, the final fallback can collapse upper rows behind an explicit hidden-line marker so the input controls and editor remain available.
- The model-facing schema, selected labels, abort/cancel behavior, and ACP elicitation path are unchanged.
