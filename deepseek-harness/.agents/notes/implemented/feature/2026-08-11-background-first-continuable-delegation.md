# Agent Note: Continuable delegation is background-first

Status: implemented

English | [中文](2026-08-11-background-first-continuable-delegation.zh.md)

## Problem

A continuable child already has a durable id, independent turns, follow-up messaging, and a manager-owned settlement notice. Treating an omitted `run_in_background` as foreground makes that lifecycle depend on the model restating `true` on every call. It also obscures the useful scheduling test: the parent should wait only when its next action requires the child's result.

The child-scoped `report` prompt requires a self-contained final report, while [manager-owned settlement delivery](2026-08-06-manager-owned-subagent-settlement-delivery.md) independently sends the run outcome and closing message. A completed child can therefore wake its parent with a final report and again with settlement. Background-first scheduling must preserve both deliveries: the child-authored handoff remains mandatory guidance, while the manager-authored notice covers every terminal path regardless of model compliance.

## Decision

`tool-subagent` resolves an omitted `run_in_background` from the selected lifecycle policy. `backgroundMode: continuable` resolves omission to background and returns the durable child id immediately; explicit `false` selects foreground and waits for the result. `backgroundMode: one-shot` keeps its foreground default because background output still requires Task collection. `enableRunInBackground: false` continues to omit the parameter, reject forced `true`, and run in the foreground. No second default-selection config is added.

The model-facing text divides responsibility by location:

- the tool description states the call behavior, durable id, runtime settlement notice, follow-up through `send_message`, and the explicit foreground override;
- the `run_in_background` parameter states the lifecycle-specific default and when to override it;
- a `tool:<toolName>` system-prompt section tells the model to start independent delegations together, continue useful work while they run, and choose foreground only when the next action depends on the result. The section renders only when that tool remains visible in the assembly scope, so a child tool restriction removes the schema and its guidance together.

The [continuable child report obligation](2026-08-06-continuable-child-report-obligation.md) remains unchanged: the child prompt requires one self-contained final report and earlier reports for findings that change the parent's next action. Manager-owned settlement remains unconditional and does not inspect whether a report arrived. The two messages may repeat final content, but they retain distinct authors and purposes: `report` is the child's explicit handoff, while settlement records how the run ended and preserves terminal output when the child cannot cooperate. `reportDelivery` remains deployment scheduling policy with `wakeup` as its default.

The keyless headless `subagent-settlement` scenario omits `run_in_background`, receives the immediate child id, and reaches the final parent answer through the manager-authored settlement notice even though its fixture deliberately does not call `report`. Package tests separately pin explicit `false` as foreground, the parent scheduling text, and the child's mandatory-report prompt.

## Alternatives considered

**Replace the field with `run_in_foreground`.** Reversing the boolean makes the common case read positively, but creates a second vocabulary for the same scheduling choice and forces every existing caller and provider-facing transcript to change. Keeping `run_in_background` preserves one field and makes foreground the explicit exception.

**Add a configurable background default.** A separate default can disagree with `backgroundMode`, the schema wording, and the installed prompt. The lifecycle policy already distinguishes a continuable activation from a one-shot Task, which is the distinction that determines whether background completion is delivered automatically.

**Change only the prompt.** Prompt preference without runtime resolution still turns an omitted argument into foreground. The model must be able to rely on the advertised default rather than reproduce it perfectly on every tool call.

**Suppress settlement after a final report arrives.** Conditional settlement reintroduces per-Activation bookkeeping and loses the unconditional runtime guarantee when a child reports progress and then fails. Settlement remains unconditional even when the resulting message overlaps a final report.

**Use `report` only for progress before settlement.** This removes duplicate final content but also removes the explicit child-authored handoff from the child prompt. The final-report obligation remains, and runtime settlement remains its independent fallback and terminal record.

## Consequences

- An ordinary continuable call is non-blocking without spelling `run_in_background: true`; serialized delegation is an explicit `false` choice.
- Independent subagent calls in one assistant message overlap under the tool loop's concurrency-safe dispatch, while dependent foreground calls can still be issued one at a time.
- Parent guidance, tool schema, runtime resolution, and settlement delivery state the same default.
- A compliant child reports one self-contained final result and may report important findings earlier. Every Activation also produces an unconditional settlement notice, so a completed run may deliver overlapping final content twice.
- One-shot background Jobs and disabled-background tool instances retain their existing behavior.
