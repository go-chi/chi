# Agent Note: Web conversation UI polish sweep

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-28-web-conversation-polish-sweep.zh.md)

## Problem

A design review of the web GUI's conversation surfaces found a batch of presentation defects: portal menus painted one frame at the wrong position before repositioning (visible open jump), the chat column split one tool run into several groups whenever a step message carried only tool-call heads, tool row summaries printed workspace-absolute paths that consumed most of the row, the running-row sweep was implemented as an alpha mask that dimmed the whole row, the hero workspace chip resurrected a deleted workspace's folder name from the session cwd, and the header showed a turns counter nobody asked for next to a 13px title.

## Decision

The sweep lands as presentation-layer changes only; nothing enters the session log.

- **Portal menus pre-render hidden and measure before paint.** The menu list mounts with `visibility: hidden` at (0,0), measures in `useLayoutEffect`, and becomes visible already at its final position. Menus keep 12px viewport clearance with internal scroll; workspace create actions pin in a non-scrolling footer.
- **The chat flow skips assistant nodes that render nothing.** A finalized assistant node whose blocks are only tool-call heads and blank text/reasoning is dropped from the flow derivation, so consecutive tool results merge into one group. Interrupted nodes always render (they carry the 已停止 marker).
- **Tool row summaries relativize workspace-rooted paths.** The session cwd threads through the toolview slot contract (`ToolRowOwnerProps.cwd`) and `toolRowModel` strips it from summaries that start with it; paths outside the workspace stay verbatim. Display-only — args and the log are untouched.
- **The running sweep is a glare-band overlay.** A fixed-width `::after` gradient band animates across the row (the deepsuite ShimmerText pattern), replacing the previous `mask-image` approach, in both ToolRow and the Bash toolview.
- **The hero workspace chip is a selector, not an echo.** With no live selection (cold start, or the workspace was deleted after the list settled) it shows a "Choose workspace" placeholder; the cwd-derived name only bridges the initial list load, and stale pending picks clear when their workspace leaves a ready list.
- **One 16px vertical rhythm.** The chat column gap and in-group tool-row gap are both 16px, replacing the 10px in-group gap plus a negative cross-group margin.
- **Header title reads 14/20 with no turns counter**; StateDot ongoing and the turn tail use a stepped pixel-chase loading language; `body` gets grayscale antialiasing (`-webkit-font-smoothing` and the Firefox macOS equivalent).

## Alternatives considered

- **Position menus synchronously from anchor rects before mount.** Rejected: the list's own size is unknown until it lays out, so clamping to the viewport still needs a post-layout measure; measuring a hidden mounted node is the pattern React and Floating UI document.
- **Filter empty assistant messages host-side.** Rejected: the node is real model output that Trajectory and replay must keep; only the chat presentation should skip it, and the web layer is pure presentation by contract.
- **Relativize paths in each tool's presenter.** Rejected: the redundancy is shared by every path-summarizing tool; one display-only pass in `toolRowModel` covers them all and non-chat consumers keep absolute paths.
- **Keep the mask-based sweep.** Rejected: the mask dims the entire row content including state dots, and its exit transition fought the hover icon crossfade; an overlay band composites above the content without touching its alpha.
- **Keep showing the deleted workspace's name in the chip.** Rejected: the chip is the selector for the *next* session; echoing a cwd whose workspace the user just deleted misrepresents the current pick.

## Consequences

Chat renders fewer flow items than the snapshot has nodes: anyone counting rendered blocks against nodes must account for skipped render-nothing assistants (the chat-view spec pins this). The path relativization is a prefix check against the session cwd, so a workspace rename mid-session shows absolute paths until the summary re-derives — accepted as display-only staleness. The uniform 16px rhythm retires the tighter 10px tool-run look; a future denser layout would reintroduce a second constant deliberately. The menu pre-render adds one hidden layout pass per open, negligible at menu sizes.

## Testing

`chat-view.spec.tsx` pins the render-nothing grouping (including the interrupted exception); `chat-tool-row.spec.tsx` pins cwd relativization inside/outside the workspace and with an empty cwd; `atoms.spec.tsx` and `workspace-picker.spec.tsx` cover the menu and chip states; the full ui-conversation, ui-primitives, and ui-workspace suites pass.
