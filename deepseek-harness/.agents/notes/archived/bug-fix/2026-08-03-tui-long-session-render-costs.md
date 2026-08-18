# Agent Note: TUI long-session render costs — shared step-timing scan and card line caches

Status: implemented
Archived: 2026-08-04

English | [中文](2026-08-03-tui-long-session-render-costs.zh.md)

## Problem

On a long resumed session (196k events, 2.2k steps, 1.8k tool cards) the TUI took ~12 s to render the transcript and ~800 ms to echo one keystroke. Profiling attributed both to the render path, not to session load (zstd + parse + surface seed is ~1.7 s):

- Every step's timing footer called `stepTimingAt`, which replayed the whole event log from index 0 per footer — O(steps × events) on the initial render, ~6 s of CPU.
- pi-tui re-renders every component each frame and relies on per-component line caches (its own `Text`/`Markdown` cache by `(text, width)`). `ToolCardComponent.render()` and `ContextCardComponent.render()` built throwaway `new Text(...)`/`new Markdown(...)` instances inside `render(width)`, so every frame — every keystroke — re-wrapped every settled card's output.

## Decision

`packages/ui/tui/src/chat/timing.ts` replaces `stepTimingAt` with `StepTimingTracker`: one accumulator per chat mount, created in `createTuiChat` and threaded through `StreamingAssistantComponent` into each `StepTimingComponent`. A query advances a cursor over events appended since the previous query and keeps per-step bucket state in a map, so all footers together cost O(events). The open bucket is accumulated to the query clock at lookup, and a step is pinned at its `step/end`. The tracker requires the append-only session log (the `seq = log length` contract).

`ToolCardComponent` and `ContextCardComponent` cache their rendered rows keyed by width. The cache drops on every state mutator (`updateResult`, `setVisibility`, `setExpanded`) and on `invalidate()` (pi-tui's tree-wide cascade), so a state change always re-renders; everything else — including every keystroke frame — returns the cached rows. This restores upstream pi's own component convention (persistent child components plus explicit `cachedWidth`/`cachedLines` where rendering is custom, e.g. pi `coding-agent` `bash.ts`), which the imperative `render(width)` bodies here had silently defeated.

Measured on the 196k-event session (tmux, 200×50): resume prompt-ready 12.2 s → 7.2 s; per-keystroke echo 796 ms median → 17 ms (fresh-session parity).

## Alternatives considered

- **Index `step/start` offsets, keep per-footer replay** — removes the `findIndex` but each footer still scans its step's span from a shared array; the tracker's single shared pass is the same complexity win with less bookkeeping.
- **Restructure the cards into persistent pi-tui child components** (upstream pi's primary style) — equivalent steady-state cost, but a larger diff across card state handling for no additional win over the width-keyed cache.
- **Cache inside pi-tui's `Container.render`** — wrong layer: the vendored patch surface would grow, and the contract (components own their caches) already exists upstream.

## Consequences

- Typing latency no longer scales with total tool output; the residual per-frame cost is pi-tui's tree traversal and row concatenation, linear in rendered rows. Resume render cost is now dominated by pi-tui's one-time initial layout (~4 s at 196k events) plus load (~1.7 s), both linear.
- The tracker consumes event times as logged and drops the removed implementation's mid-scan `time > at` cutoff, which per-footer `at` values make impossible in a shared scan; under a backward wall-clock step each bucket clamps at zero, which can differ from the old cutoff's totals.
- Card `render()` is no longer a pure function of `(state, width)` per call — mutators must drop `linesCache`. A new mutator that forgets to do so shows stale rows; the cache tests in `packages/ui/tui/tests/transcript-card-cache.spec.ts` pin the contract for the existing mutators.
- `StepTimingTracker` assumes step coordinates are not reused after `step/end`; a duplicate `step/start` for a closed step is ignored rather than restarting the step.
