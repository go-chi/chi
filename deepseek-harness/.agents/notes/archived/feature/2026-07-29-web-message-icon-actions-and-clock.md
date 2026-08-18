# Agent Note: Web message IconActions and clocks

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-29-web-message-icon-actions-and-clock.zh.md)

## Problem

The web chat user bubble already had copy / branch / edit IconActions but no clock. Finalized assistant narration had no under-body action chrome at all, even though the Harness design shows a copy / branch / clock row after the answer settles. Streaming replies must not flash that chrome mid-token. Memoized rows also keep stable props across midnight, so a one-shot `Date.now()` would leave yesterday's messages stuck on `HH:mm`.

## Decision

**User bubbles prepend a date-aware local clock to the existing IconActions row; the last content-text assistant of each turn appends a copy / branch / clock row with `margin-top: 16px`; both seats stay visible whenever mounted and re-format at the next local midnight.**

The assistant seat is narrowed by the [completed-turn decision](../bug-fix/2026-08-05-turn-tail-actions-require-a-completed-turn.md): only a turn with a `turn/end` grants it, so a turn still producing steps hands the row to nothing. The user seat's branch control is removed outright by the [user-bubble branch removal](../simplification/2026-08-06-user-bubbles-drop-the-branch-action.md); a user row's IconActions are clock and copy.

Both seats format `node.time` through `formatMessageClock`: same calendar day → `HH:mm`, earlier this year → `M月D日 HH:mm`, other years → `YYYY年M月D日 HH:mm`. `useCalendarDay` is a component-local day tick (timeout to the next local midnight) so memoized rows re-render when the calendar day changes without a new framework hook. `MessageItem` places the label before copy (figma `388:20051`). `ChatView` derives turn-tail seqs via `assistantActionsSeqs` and withholds `time` for mid-turn content; `AssistantMarkdown` places the row after branch (figma `43:32997`) only when `streaming` is false, the event time is known, and the node has non-empty text content. Think-only nodes, mid-turn narration, and the streaming tail omit the row. Copy writes joined text blocks. Both message rows pass their event's `seq` to the same fork callback; [Web session fork actions](2026-07-27-web-session-fork-actions.md) define the real mutation contract. Clipboard write and the clock helpers live in `message-chrome.ts`. The assembled surface is pinned by `apps/web/tests/message-actions.e2e.ts` (cold-seeded history + aria golden); aria normalization collapses every clock shape to `{{clock}}`.

## Alternatives considered

**Show assistant IconActions during streaming.** Rejected: the request is to reveal the row only after output completes; mid-stream chrome would flicker and invite copying a partial answer.

**Put IconActions under every finalized assistant node (including Think-only).** Rejected: copy has nothing useful to write without text content, and repeating the chrome under every step/Think row clutters the flow; only content output owns the seat.

**Put IconActions under every content-text assistant in a multi-step turn.** Rejected: mid-turn narration (text before tools) is not the settled answer; repeating copy/branch/clock under each step clutters the flow. Only the last content assistant of the turn owns the seat.

**Hover-reveal the action row on hover-capable pointers.** Rejected: once the row exists it should stay discoverable; opacity hiding made the chrome easy to miss and required parent hover selectors that duplicated the mount gate.

**Let the IconActions decision also define session fork semantics.** Rejected: this note owns only message chrome, clocks, and mount gating; boundary selection, failure behavior, and switching semantics belong to the separate [Web session fork actions](2026-07-27-web-session-fork-actions.md), keeping presentation components from becoming a second home for session mutation.

**Publish the calendar day through a chat store or inject hook.** Rejected: the day tick is presentation-only local state with no cross-entry consumers; a component-local timeout matches the client rule that behavioral hooks may own state that does not subscribe to an external source.

## Consequences

Each turn's last settled content answer exposes copy, branch, and the event clock as soon as the row mounts; mid-turn content and Think-only nodes stay chrome-free. User and assistant clocks share the same day/year widening rules and refresh after midnight without a message mutation. Per-message paging remains a deferred footer seat in the package README. Package tests pin the three clock shapes, the midnight widen, the content-only assistant gate, the turn-tail seq gate, and the respective event `seq` values passed by the user and assistant branch buttons; the web e2e scenario pins the assembled IconActions chrome.
