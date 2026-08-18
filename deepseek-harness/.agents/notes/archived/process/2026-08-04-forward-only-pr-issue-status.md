# Agent Note: Forward-only PR-to-Issue status projection

Status: implemented
Archived: 2026-08-10

English | [中文](2026-08-04-forward-only-pr-issue-status.zh.md)

## Problem

The Issue Project status represents the phase of the work, while an exact same-repository resolving keyword establishes the authoritative PR-to-Issue relationship. Restricting lifecycle advancement to Issues already in `Ready` leaves an Issue in `Inbox` or `Backlog` after implementation has demonstrably started. Requiring otherwise valid PR metadata before projecting the phase also conflates policy compliance with the work's observable state.

## Decision

PR and PR-review events project the current PR phase to every exact same-repository resolving Issue. A draft PR, or a non-draft PR without a review request or submitted review, targets `In progress`. A non-draft PR with either form of review activity targets `In review`.

The active statuses have the order `Inbox`, `Backlog`, `Ready`, `In progress`, and `In review`. Projection writes only when the target is later in that order. It does not move an Issue backward, alter `Done` or `No action`, or add an Issue that has no Project status. The lifecycle path is independent of PR metadata validation; the separate required PR policy check continues to enforce labels, references, and priority consistency.

This projection is intentionally one-way. It does not query from an Issue to related PRs, and it does not add a scheduled reconciler. PR events are the source of lifecycle advancement. The pure transition decision is exercised by the Issue-management test and that test runs in the `check-all`, `ci-primary`, and `ci-static` gates.

## Verification

`.github/issue-management/policy.test.mjs` covers advancement from every earlier active status, the draft and review distinctions, metadata-policy independence, and protection against backward or terminal transitions. `scripts/run-gates.ts` owns execution of that focused policy test in top-level local and CI gate modes.

## Alternatives considered

**Require `Ready` as the only source status.** This preserves a manual prerequisite but leaves stale `Inbox` and `Backlog` items even though the resolving PR proves implementation has begun.

**Add bidirectional or scheduled reconciliation.** Looking up PRs from Issue events or sweeping the Project could repair more histories, but it adds another authority direction and recurring API work beyond the required PR-driven lifecycle.

**Gate projection on complete PR metadata.** Labels, references, and priority still require enforcement, but a metadata defect does not make the implementation or review phase untrue.

**Move statuses backward when a PR becomes a draft or loses reviewers.** That would make transient PR state overwrite a later observed work phase and complicate status ownership. Projection therefore remains monotonic.

## Consequences

- A PR event self-corrects a resolving Issue left in `Inbox`, `Backlog`, or `Ready`.
- An Issue created after the last relevant PR event waits for a later PR event or a manual status update because there is no reverse lookup or scheduled sweep.
- A draft PR remains `In progress` even if it has historical review activity; only a non-draft PR targets `In review`.
- Terminal statuses and later active statuses remain protected from regression.
- PR metadata failures remain visible through the required policy check without suppressing lifecycle projection.
