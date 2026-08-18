# Agent Note: TUI footer shows the session cache hit rate

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-tui-footer-cache-hit-rate.zh.md)

## Problem

The footer summed the session's token usage as `↑<input> ↓<output>`, where `↑` is the uncached input reported by the model. `TokenUsage` counts are disjoint: billed prompt tokens are `inputTokens` (uncached) plus `cacheReadTokens` and `cacheWriteTokens`. With only the uncached number visible, a user could not tell how much of each turn's prompt the provider cache served — the signal that most directly reflects whether the reused request prefix is paying off. On a long session dominated by cache reads the `↑` figure stays small and hides that the prompt is large but cheap.

## Decision

The footer appends `cache <rate>%` after `↑<input> ↓<output>`, where the rate is the share of billed prompt tokens served from the provider cache.

- `TokenTotals` accumulates the four disjoint buckets (`input`, `output`, `cacheRead`, `cacheWrite`). `addUsage` folds one call's `TokenUsage` into the totals, treating a missing `cacheReadTokens`/`cacheWriteTokens` as zero.
- `cacheHitRate(totals)` is `round(cacheRead / (input + cacheRead + cacheWrite) * 100)`, and `undefined` before any input is billed. `FooterComponent` omits the whole `  cache N%` segment while the rate is `undefined`, so an empty session shows no meaningless zero.
- `↑` keeps meaning uncached input, not billed input: the disjoint-bucket convention holds across the footer, and the cache percent supplies the reuse signal the raw counts cannot.
- Totals are rebuilt on mount by `sessionTokens`, which sums usage over `assistant/message` events (never `assistant/chunk`, to avoid double counting), and updated live from each `assistant/message` event that carries usage.

## Alternatives considered

**Show billed input (`input + cacheRead + cacheWrite`) as `↑` instead of a separate percent.** Rejected: it would redefine `↑` away from the disjoint `inputTokens` bucket the rest of the harness reports, and it would still hide the reuse share the user actually wants; a derived percent adds the signal without overloading the count.

**Compute the rate against all tokens (`input + output + cache`).** Rejected: output tokens are never cache-served, so folding them into the denominator understates the rate for no meaning; cache hit rate is a property of the prompt.

**Drop `cacheWrite` from the denominator.** Rejected: cache writes are billed input the provider spent to populate the cache, so excluding them overstates the hit rate on a writing turn. DeepSeek reports no cache-write metric today, but the formula stays general and the write path is covered.

**Render `cache 0%` on an empty session.** Rejected: the billed input is `0`, the ratio is `0/0`, and a `0%` badge on a fresh session is a lie about a value that does not exist yet; the segment stays hidden until input is billed.

**Give the metric its own right-aligned footer element beside `tools:`.** Rejected: it derives from the adjacent token counts and reads best in the `input → output → cache` order; grouping it left also keeps the lower-priority `tools:` indicator as the element that clips first under width pressure, matching the footer's existing layout priority.

## Consequences

- The left group grew by `  cache N%`, so on a narrow footer the right-side `tools:` state clips sooner. This follows the footer's pre-existing left-priority truncation and is an accepted trade-off.
- The metric is best-effort live UI state derived from `assistant/message` usage: rebuilt from the session on mount, updated live, and never persisted.
- `packages/ui/tui/src/index.ts` stays at 100 % per-file coverage.
- The `examples/tui-agent` terminal snapshots carry the segment: a turn with cache reads renders e.g. `cache 49%`, and a first cold turn renders `cache 0%`.

## Testing

`packages/ui/tui/tests/tui.spec.ts` drives the footer through the real `createTuiChat`: an empty session renders `↑0 ↓0` with no cache segment (the hidden path), a cold turn (`inputTokens` only) renders `cache 0%`, and a live warm turn carrying `cacheReadTokens` and `cacheWriteTokens` updates it to `cache 60%` while no longer showing `cache 0%`. The `examples/tui-agent` snapshot suite replays green against the recorded expected output.
