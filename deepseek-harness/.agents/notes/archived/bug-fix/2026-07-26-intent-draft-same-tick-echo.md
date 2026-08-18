# Agent Note: Intent draft echoes in the same tick

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-26-intent-draft-same-tick-echo.zh.md)

## Problem

The hero composer ("Let's start building") is a controlled textarea whose value is the frontend Session Intent's retained prompt, read from the sessions **list** snapshot (`EmptyState` binds `intent.prompt` via `useSessions`). Typing routed through `SessionManager.updateIntent → Session.updatePendingPrompt`, which flushes the **Session's own** notifier synchronously — but the list snapshot the composer actually renders from only heard about the change through the intent watch subscription in `startIntent`, which calls `markDirty()`, a microtask-deferred flush.

A deferred echo violates the controlled-input contract documented on the Notifier (see the [web client architecture note](../architecture/2026-07-19-gui-web-client-architecture.md)): React compares the DOM value against the still-stale snapshot during the same tick as `onChange` and rolls the textarea back. With plain typing this shows as caret jumps; with an IME it corrupts input — every composition update gets rolled back and re-applied against a stale value, so typing Pinyin "nihao" commits fragments like "nnini hni hani hao你好". The resident composer (`ConversationRoot`) was not affected: its draft lives in the chat store (sync flush) or comes from `updateSessionPrompt`, which reads the Session snapshot directly rather than the list projection.

## Decision

`SessionManager.updateIntent` calls `this.notifier.notifyNow()` after `updatePendingPrompt`, flushing the list snapshot in the same tick as the change event. This matches the Notifier's channel rule: a direct echo of a user gesture whose controlled input renders from this snapshot uses `notifyNow`; the intent watch keeps `markDirty` for every other (async) intent transition.

## Alternatives considered

**Change the intent watch callback in `startIntent` to `notifyNow`.** Wrong channel for that seam: the watch also fires on frame-driven Session changes (publication, send phases), and the architecture note bans `notifyNow` for frame-driven sources because it collapses batching.

**Have `EmptyState` read the prompt from the Session snapshot instead of the list.** Restructures the slot contract (EmptyState is deliberately bound to the standard `useSessions` feed and has no session scope yet — the frontend Session is page-local) for no gain over flushing the projection it already reads.

**Suppress the rollback in `InputBar` with local uncontrolled state.** Hides the symptom, forfeits the single-source-of-truth draft (the retained prompt must survive workspace retargeting and send/retry), and leaves every other list-snapshot-controlled input exposed.

## Consequences

Typing in the hero composer, IME composition included, echoes synchronously. `updateIntent` on a no-intent state stays a no-op with no notification. The web workspace-flow snapshot's composer helper now asserts the same-tick echo instead of waiting for it, so a regression to a deferred echo fails the keyless snapshot gate; a runtime unit test pins the same contract at the manager seam.
