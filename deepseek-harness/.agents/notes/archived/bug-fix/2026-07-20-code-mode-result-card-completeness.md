# Agent Note: Keep the Code Mode result card complete

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-20-code-mode-result-card-completeness.zh.md)

## Problem

The outer `run_code` tool persisted complete rendered content, but its UI presenter ignored that content and rebuilt the card body from a logs-only `presentationMeta` projection. A result-only run appeared correct because an empty presenter body let consumers fall back to `tool/result.content`. Once the program emitted a log, the presenter supplied non-empty content, that fallback stopped, and the returned value disappeared from the completed card. A spill policy's final head/tail preview was vulnerable to the same split ownership whenever captured logs made the stale projection non-empty.

Nested Code calls never owned cards, so producing metadata for the outer call solely to reconstruct one incomplete card also obscured the intended one-card boundary.

## Decision

The canonical tool registry pipeline owns the final model-facing outer content. On success, the `run_code` output renderer renders captured logs followed by the return value or the explicit no-output marker. Runtime failures and pre-execution policy denials are normalized into error content by `ToolRegistry` without invoking that renderer. A post-execute block runs after successful rendering and replaces the result with error content; other post-execute policy and spill decisions may replace content before persistence.

`run_code` omits `presentResult`. The established generic result fallback keeps the pending program title and renders the raw final `tool/result.content`; that durable, replayable, post-policy projection is the card's only result-content source. The host API proxy therefore omits a separate result view instead of serializing the same content in both `event.data.content` and `view.view.content`. The redundant logs-only `presentationMeta` projection remains removed.

Nested dispatch remains unchanged. Calls marked by `exec.parent` emit `tool/code-dispatch` events (full rendered content) but no `tool/call` or `tool/result` surface cards, so one outer `run_code` invocation still produces exactly one card.

## Testing

Tool unit coverage drives logs-only, result-only, logs-plus-result, no-output, spilled-result, and failure outcomes through the canonical registry, then pins the durable content and absence of a result presenter. A host-mux regression uses a call-only presenter to prove the result frame carries raw content exactly once and no view. These cases prove stale metadata cannot replace final content without making the host duplicate that content.

The keyless ACP backend and TUI Code Mode snapshots execute one outer program that performs two nested bash calls, logs `captured output`, and returns `CODE_ONE+CODE_TWO`. The persisted ACP log pins the complete result; the TUI surface shows one completed outer card containing both lines and no nested cards.

## Alternatives considered

**Append the return value to logs metadata.** Rejected because metadata would duplicate the renderer, need a second stable formatting contract for every JSON root, and still miss post-policy content replacement or spill previews.

**Merge presenter metadata with `result.content`.** Rejected because the rendered content already contains the logs; merging would duplicate them and require brittle deduplication.

**Forward `result.content` through a generic result presenter.** Rejected because the durable event already carries that content and UI consumers already have a generic raw-content fallback. The host mux serializes a tool-owned result view beside the event, so forwarding would duplicate the rendered content in one frame merely to recreate the fallback; the default worker alone admits a 64 MiB variable-payload budget before rendering.

**Create one card per nested dispatch.** Rejected because intermediate values are intentionally execution-local and never model-facing. Multiple cards would expose an implementation trace instead of the single Code Mode operation the model and user invoked.

## Consequences

TUI and JSON-RPC/Web display the same complete content the model receives and replay persists, including post-policy spill previews, through their generic result fallback. The host API retains the pending program title without duplicating the raw result in a separate view payload. New `run_code` results no longer carry the optional logs metadata, but this requires no session-format bump: existing records remain valid because presentation reads their durable rendered content.
