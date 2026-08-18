# Agent Note: Code Mode sub-calls in the trajectory and waterfall views

Status: implemented
Archived: 2026-07-28

English | [中文](2026-07-26-code-mode-trajectory-waterfall-spans.zh.md)

> Scope: the final PR of the Code Mode UI stack — sub-dispatch rendering in the two non-chat views. Chat nesting is owned by the [sub-call rows note](2026-07-26-code-mode-chat-subcall-rows.md); the timing this consumes is the [live-parallel note](2026-07-26-code-mode-live-parallel-dispatch.md)'s start/settle pair.

## Problem

Trajectory and waterfall still rendered a `run_code` turn as one opaque Tool cell / one node-count bar. The chat view got nested sub-rows in the earlier PRs, but the two analytical views — whose whole purpose is structure and timing — showed none of the sub-call structure and none of the per-sub-call wall time the dispatch pair now records. Waterfall sub-spans were deliberately deferred until that pair existed: a span without real timing would have been a lie.

## Decision

**Trajectory: `subtool` cells interleaved after their parent Tool cell. Waterfall: real-time sub-lanes under the owning turn row.**

- **Trajectory**: the layout fold takes the snapshot's `codeDispatches` index; after each Tool cell whose `callId` has dispatches (assistant-block calls, orphan results, and running calls alike), it interleaves one `subtool` cell per sub-dispatch in start order — indexes stay sequential across the interleave. A settled sub-call's duration is its start/settle pair (`durationSeconds(sub.time, sub.callTime)`); a running one shows the em dash, exactly the native in-flight convention. The new cell kind wears a `Sub` tag (business tint) and a 28px indent so nesting reads at a glance.
- **Waterfall**: `deriveSubSpans` folds the dispatch index into per-turn lanes with REAL timing — each parent's dispatch window is first start → last settle, and every lane's offset/width is its fraction of that window, so parallel sub-calls (PR3) visibly overlap. Each lane carries a `timing` provenance tag: `measured` (pair observed), `running` (settle pending — extends to the window end at reduced opacity), or `unknown` (settle-only replay window, `callTime: null` — drawn hollow and titled "duration unknown", never a fabricated 0 ms). Lanes draw under the owning turn's bar row, scaled into a fixed lane budget.
- Both views read `codeDispatches` through the standard snapshot hook — no new wire data, no new stores; replay renders identically to live by construction.

## Alternatives considered

**Fold sub-calls into the turn-span node counts (weight the existing bars).** Rejected: it hides exactly the structure this stack exists to show, and node-count weighting is already flagged as a stand-in (deviation ledger #3).

**A dedicated sub-call panel instead of in-view nesting.** Rejected: the stack's settled UX is nesting under the parent everywhere; a separate panel would diverge from chat and double the selection plumbing.

**Defer waterfall lanes until the P-III duration-lane redesign.** Rejected: the sub-lane timing is real today (the pair), and the fraction-of-window rendering is independent of whatever the turn-level lanes become; deferring would strand the stack's timing payoff.

## Consequences

The waterfall carries the first REAL wall-time rendering in the client (turn bars remain node-count stand-ins — the contrast is deliberate and labeled by hover titles). Trajectory cell indexes now count sub-calls, so `#N` totals grow on Code Mode turns. Specs pin the interleave order and durations, the running em-dash arm, window fractions (offsets/widths), the running-lane extension, the unknown-timing (settle-only) lane, and the rendered lane under the turn row; the built-client Code Mode fixture snapshot additionally pins both tabs' assembled rendering (sub-cells with real +0.8s durations, measured lanes).
