# Agent Note: TUI hidden mode folds a turn's assistant steps into one message

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-29-tui-hidden-mode-assistant-fold.zh.md)

## Problem

Ctrl+O's hidden phase ([consolidated TUI presentation](../architecture/2026-07-28-consolidated-tui-presentation.md)) drops tool cards so the transcript reads as a conversation, but each model step still rendered its own `Assistant` header. A multi-step turn (text → tools → text) therefore showed several consecutive `Assistant` blocks with nothing between them — the removed tool cards were the only thing that had justified the repeated headers. Codex-style conversation-only reading wants one assistant message per turn.

## Decision

Hidden mode is also a fold rule, applied purely as TUI presentation: per turn, the first step whose rendered content is visible (text, or reasoning while reasoning display is on) owns the turn's single `Assistant` header; every other step renders as a headerless continuation, and a step with no visible body renders nothing at all — a tool-only step neither consumes the header nor leaves a blank segment. Collapsed and expanded phases keep per-step headers; leaving hidden restores them.

Mechanics: `StreamingAssistantComponent` carries its `StepPosition` and a `setFoldedContinuation` presentation flag; `createTuiChat` keeps a per-turn list of step components and re-derives the fold on Ctrl+O, on each streamed text/reasoning chunk, on message settle, and on retraction of a failed stream (which may hand the header to the next step). Transcript rebuild clears the map and replays the log, so resume, compaction replacement, resize, and theme swaps converge on the same fold. Step timing footers keep their per-step ownership and are unaffected.

## Alternatives considered

- **Merge steps into one component** — collides with per-step streaming lifecycle, retry retraction, and timing footers; the flag on existing components changes only the header/spacer.
- **Fold in the session log or `deriveMessages`** — mutates durable/model-visible history for a UI reading mode; the log stays step-shaped.
- **Always fold (all visibility phases)** — collapsed/expanded interleave tool cards between steps, where per-step headers delimit which output belongs to which step.

## Consequences

Hidden mode now reads as one assistant message per turn; turns stay separated by their headers. The fold is recomputed state, never stored, so no session or persistence format changes. Coverage: TUI unit specs for the Ctrl+O cycle header counts, tool-only first step header handoff, per-turn separation, and live streaming + rebuild convergence; keyless snapshot `tool-cards-hidden-folded` pins the folded frame.
