# Agent Note: Status-driven disclosure for workflow runs

Status: implemented

English | [中文](2026-08-11-workflow-run-status-driven-disclosure.zh.md)

## Problem

A durable workflow Chat node updates in place from its running prefix to a terminal record. A disclosure choice initialized only at mount can hide a newly running phase, leave completed work occupying the conversation, or bury a failed, cancelled, or interrupted member behind two collapsed levels. Making openness a pure function of completion avoids those failures but also prevents users from reopening clean history for review.

The renderer already receives every required lifecycle fact from the workflow Conversation Node. Visibility therefore needs a component-local lifecycle that gives current execution and attention states priority without adding another durable fact or taking ownership of workflow outcomes.

## Decision

Each phase derives one visibility requirement from its current members. A running, failed, cancelled, or interrupted member forces that phase open; a phase whose members are all completed is clean. The workflow forces itself open when its own status requires attention or any phase is forced open, so an abnormal member remains visible even when the workflow outcome is recorded as completed. A completed sibling phase remains independently collapsible.

A forced-open level renders as an expanded static row. It exposes no button role, focus target, keyboard toggle, or `aria-expanded` value because collapsing cannot change the result. This keeps the visual hierarchy and status summaries while making the interaction promise match the available action.

A clean level mounts an ordinary controlled disclosure in the closed state. Its local choice survives rerenders for the same continuous clean interval. New running or abnormal data replaces that manual interval with forced expansion; the next transition back to clean mounts a fresh closed disclosure, which produces one automatic fold per activity cycle. Closing the workflow naturally unmounts its phase controls, and a Session remount reconstructs every level from the current durable status rather than restoring an earlier choice.

For example, a running workflow exposes its active phase and member without clicks. When that phase completes, only the phase folds while the workflow remains open; when the workflow and every phase complete, the workflow also folds. The user can then reopen both levels for review. If another member starts under the same phase key, both affected levels immediately return to forced expansion and fold again only after the new activity completes.

The renderer owns only this visibility lifecycle. It does not add Session events, stores, settings, acknowledgement state, timers, focus movement, automatic scrolling, or cross-remount persistence. It does not change workflow status derivation, phase grouping, member order, navigation eligibility, copy, or the shared `DisclosureRow` API. Shared `data-expandable` styling owns pointer cursors, so forced-open static rows do not advertise an unavailable action. An interrupted durable prefix remains an attention state and therefore stays visible until the underlying facts change.

## Verification

Component tests drive the same keyed workflow and phase through running, clean completion, manual review, renewed activity, repeated clean completion, zero-member completion, and each abnormal status. They also verify abnormal-member propagation, clean-sibling independence, mouse and keyboard review, continuous-clean choice retention, and the absence of false button and ARIA semantics while expansion is mandatory.

The shipped Web replay observes the real workflow, worker, Session log, browser plugin graph, and child navigation. It requires the live workflow and active phase to be visible without disclosure controls, the normally settled workflow and phase to fold, manual review to retain the terminal member without navigation, and a reload to reconstruct the folded history from durable facts.

## Alternatives considered

**Keep one manual state initialized from the first render.** Rejected because later lifecycle updates cannot reopen newly active or abnormal content and cannot fold normally settled work.

**Derive `open` directly from whether a level is clean.** Rejected because completed history would remain permanently closed and could not be reopened for review.

**Persist expansion, acknowledgement, or read state.** Rejected because current lifecycle facts already determine mandatory visibility, while review choice belongs only to the mounted presentation. Persistence would add a second state owner and require semantics for stale choices, abnormal acknowledgement, replay, and synchronization that the user result does not need.

## Consequences

Workflow records expose current work and abnormal outcomes without preparatory clicks, then reclaim conversation space after normal completion without sacrificing review. Interaction semantics remain truthful during automatic control, and the same durable record produces the same initial state during live rendering, refresh, and history reconstruction.

The trade-off is deliberate local reset behavior. A phase choice disappears when its parent workflow closes or the component unmounts, and abnormal records cannot be manually hidden because the product has no acknowledgement state. Supporting either behavior later requires a separate ownership and persistence decision rather than extending this local lifecycle implicitly.
