# Agent Note: Hero stays visible while a blank session opens

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-31-hero-visible-while-blank-session-opens.zh.md)

## Problem

The conversation root has a `settling` phase for a session that is still opening while its composer reads `blank`: the hero-versus-docked outcome is unknowable until history arrives, so the composer seat is hidden (`visibility:hidden`) rather than flashing the centered hero and snapping to the docked bar. Startup auto-selection turned that guard into the defect it was meant to prevent. From the no-workspace hero, `WorkspacesService.startInitialSelection` connects the most recent workspace and opens its blank session; `openState` flips to `loading` the moment `open()` lands, so the center column went blank for the whole history round-trip and then repainted, which reads as a full-page refresh on every launch.

## Decision

`ConversationRoot` reads the session list summary's `blank` flag alongside the conversation snapshot and exempts summary-proven blank sessions from settling: `settling` additionally requires `summaryBlank !== true`, and `hero` accepts a blank composer whenever the summary proves the session blank, in every open state rather than only `loading`. A session the list already reports as blank can only land on the hero, so hiding buys nothing and costs the visible flash; the same proof holds before the open starts (`cold`) and after one fails (`error`), where the previous conditions fell through to the active phase and rendered a docked bare composer under chrome `ConversationSession` hides for blank sessions. Whenever the summary does not prove the session blank — a row reporting `blank: false`, or no row at all because the list has not caught up — `summaryBlank` is not `true` and the conservative settling hide is unchanged.

The summary flag and the snapshot's own `blank` are distinct sources: the snapshot describes the session being opened, the summary is the list row that already exists before the open resolves. Only the latter is available early enough to decide the phase.

## Alternatives considered

**Drop the settling phase entirely.** Rejected because it still earns its keep for a session with no summary row: without a prior claim about emptiness, hero-versus-docked is genuinely unknowable and the flash it prevents is the worse one.

**Delay the `loading` flip until history returns.** Rejected because `openState` is authoritative about the open operation; deferring it to suppress a presentation artifact would misreport the data state to every other consumer.

**Cross-fade or otherwise animate the settling hide.** Rejected because the column has nothing to show during the round-trip either way — the fix is to not hide content whose outcome is already known, not to decorate the hiding.

## Deferred

Object-layer reference churn found while diagnosing this — no-op projections minting fresh snapshots, the create path projecting twice, `select()` using `notifyNow` from async continuations — is real but independent of the visible flash.

## Consequences

Startup auto-selection renders the hero immediately and keeps the composer seat and header visible through the history round-trip, so launching into a recent workspace no longer looks like a page reload. Sessions whose summary does not prove them blank keep the previous settling behavior, so the guard still covers the case it was written for. Skeleton tests pin all three summary shapes: a row reporting `blank: false` settles, an absent row settles, and a summary-proven blank session opening under `loading` renders hero chrome with a live textarea.

The assembled coverage is `apps/web/tests/startup-auto-selection.e2e.ts` (keyless web browser lane). Its first Workspace connection asserts that the Hero root, Workspace chip, scroll body, composer seat, and textarea remain the same DOM nodes when the blank Session appears. It then holds the `session.history` response open at the browser's network boundary and asserts the visible frame while the auto-selected open is in flight — hero phase, hero title, painted composer — plus a recorded phase timeline of exactly `['hero']` for the whole load. Holding the round-trip is what makes the second case a regression test rather than a race: against a loopback host the open settles too fast to sample, and with the exemption reverted the held window is precisely when the root reports `settling`.
