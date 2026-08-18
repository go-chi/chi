# Agent Note: Trajectory step cell and turn list chrome

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-23-trajectory-step-cell.zh.md)

## Problem

The trajectory tab needs a reusable step row and turn-list chrome that can show expanded assistant blocks, own-duration times, Message token columns, and in-flight work. Without folding session event times into conversation nodes and expanding blocks into cells, the UI cannot match the product chrome.

## Decision

[`@deepseek-ai/dsh-client-ui-trajectory`](../../../../packages/client/ui-trajectory/README.md) owns the presentational trajectory list chrome:

- [`TrajectoryCell`](../../../../packages/client/ui-trajectory/src/client/TrajectoryCell.tsx) — 38px step row with kinds User / Message / Tool (no Think, Call, or Result rows). Reasoning blocks are skipped (no block-level clock). Each `tool-call` + paired `tool-result` folds into one Tool row (`name ·` truncated args) whose Time is `result.time − callTime` when both are known. Message rows carry Input/Output/Think token columns from `assistant.usage`. Own-duration Time uses `+Ns` / `+N.1s`, or `—` when absent. Selected state draws a 2px inset `--dsw-alias-brand-primary-new-colorprimary-new-color` ring (`selected` prop) and is not wired to chat selection.
- [`TrajectoryTurn`](../../../../packages/client/ui-trajectory/src/client/TrajectoryTurn.tsx) / header / group header — sticky Turn bar paints full-bleed `ghost-active-fill`; title/columns and the Message/Step body sit in a centered `max-width: 880px` lane. Cell trailing columns share the Turn header geometry (`320 = 4×71 + 3×12`); cells use pad 20/8.
- [`deriveTrajectoryLayout`](../../../../packages/client/ui-trajectory/src/client/layout.ts) expands assistant `blocks[]` into cells, pairs tool-calls with `tool-result` by `callId` into Tool, folds `partial` and `runningCalls` (deduped), hangs usage on Message only (including the empty fallback when there is no text block), and builds group descriptions as wall-span + tool histogram (`1.5s bash×6`). `user/message` has no wire turn, so each User row is enclosed in the next assistant/steering turn, else the in-flight `partial` turn, else `lastAssistantTurn + 1` (or `1`). Context nodes emit no cell but still advance the Message duration cursor.

[`ConversationNode`](../../../../packages/client/runtime/src/client/sessions/conversation.ts) carries `time` from `SessionEvent.time`; `ToolResultNode.callTime` and `RunningToolCall.time` come from the paired `tool/call`. Duration rules: User `+0s`; Message = assistant.time − previous surface time (including skipped context); Tool = result.time − callTime when both known; in-flight Tool = `—`. Group header duration is earliest→latest absolute time in the group (wall span; Tool contributes start and start+duration).

## Alternatives considered

**Keep a Think cell for reasoning blocks.** Rejected: a single `assistant/message.time` cannot yield Think own-duration without chunk-level clocks; omit the row rather than show `—`.

**Keep separate Call and Result rows.** Rejected: Result had no own duration to show; one Tool row carries the call→result interval.

**Cumulative elapsed from session/turn start.** Rejected; the Time column is each row's own duration.

**Hang usage on the first expanded row.** Rejected; usage attaches to Message only.

**Show in-flight tool durations via Date.now().** Deferred; in-flight Time stays `—`.

## Consequences

The Trajectory tab can render expanded finalized and in-flight rows with own-duration times once fold emits `time`. Behavior-shaped coverage lives in `packages/client/ui-trajectory/tests/{cell,layout,views}.spec.tsx`. Chat selection deep-links and finer block-level clocks remain deferred.
