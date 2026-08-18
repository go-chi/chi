# Agent Note: Review-driven Issue lifecycle triggers

Status: implemented
Archived: 2026-08-10

English | [中文](2026-08-08-review-driven-issue-lifecycle-triggers.zh.md)

## Problem

The Issue lifecycle workflow reads the current pull request after each subscribed repository event and projects resolving Issues forward to `In progress` or `In review`. A resolving draft already reaches `In progress` from its `opened` event. Changing that draft to ready creates no new lifecycle outcome until a reviewer is requested or submits a review, yet subscribing to `ready_for_review` launches another hosted job and creates another GitHub App token.

Draft-to-ready automation commonly submits a review moments later. In that sequence the ready job cannot advance the Issue, while the review job is still required to observe the `In review` phase.

## Decision

[Issue lifecycle](../../../../.github/workflows/issue-lifecycle.yml) does not subscribe to `pull_request.ready_for_review`. It retains `pull_request.review_requested` and `pull_request_review.submitted`, so either a requested reviewer or a submitted review can advance a resolving Issue to `In review`. The handler continues to fetch the live pull request instead of deriving phase from the triggering payload.

[Issue policy](../../../../.github/workflows/issue-policy.yml) still subscribes to `ready_for_review`. That workflow owns the required check when a human pull request enters review; removing a lifecycle trigger does not weaken policy enforcement.

The workflow test parses both files and pins this split. The lifecycle policy tests separately pin that draft and open resolving pull requests reach `In progress`, while a review request or submitted review reaches `In review`.

## Alternatives considered

- **Keep both events and cancel an in-progress run** - rejected because concurrency can discard a pending run but cannot combine two webhook payloads into one execution. Cancelling the earlier mutation also makes correctness depend on arrival order, while a completed ready job still consumes the full runner setup.
- **Remove the submitted-review event** - rejected because a review may arrive without an explicit review request. In that path `pull_request_review.submitted` is the only repository event that exposes the transition to `In review`.
- **Delay every pull request event behind a debounce dispatcher** - rejected because another queue or scheduled workflow adds latency and control-plane state to eliminate a trigger that carries no lifecycle information.

## Consequences

A draft becoming ready no longer launches Issue lifecycle work. The resolving Issue remains `In progress` from an earlier pull request event until a review is requested or submitted, at which point one review-driven run can advance it to `In review`. The required Issue policy check still runs at the ready boundary.

If a future lifecycle phase depends on ready status itself, that change must restore the trigger and update the workflow test and this decision. Until then, omitting `ready_for_review` saves one hosted run from the common ready-then-review sequence without dropping a status transition.
