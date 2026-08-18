# Agent Note: The session prefix — request-only messages in front of the derived history

Status: implemented
Archived: 2026-07-28

English | [中文](2026-07-07-session-prefix.zh.md)

The request-only prefix seam described below was later removed by the [unified sourced-message decision](../architecture/2026-07-22-unified-send-and-coalesced-user-messages.md). Current producers inject durable sourced `user/message` context at `agent/step`; this record preserves the earlier design and its trade-offs.

## Problem

A plugin often owns a session-stable opener the model must always see — a skills catalog, an AGENTS.md digest, a workspace baseline. Before this seam the harness offered two homes, and both are wrong for that content. The system prompt is one rendered string: message-shaped content (a user-role `<system-reminder>` envelope, a multi-message primer) does not fit it, and providers weight conversation messages differently from system text. Durable history (`agent.inject()`, a `context/message` at session start) makes the opener permanent: every `deriveMessages()` consumer replays it, the compaction retention walk owns it, forks bake it in stale, and a resume cannot refresh it — a catalog captured at session birth outlives the world it described.

The obvious third option — let a plugin edit the request's `messages` on the way out — is banned by [the reconstructable-requests Agent Note](../architecture/2026-07-05-reconstructable-requests.md): every loop-built request is a pure function of the session log, so whatever channel carries the opener must log exactly what it sends. What was missing was a request-only message channel with a durable record.

## Decision

`agent/session-prefix` is a waterfall on the agent event map ([`packages/core/agent/src/types.ts`](../../../../packages/core/agent/src/types.ts)): listeners receive a frozen empty seed and return an extension (the canonical contribution is a prepend, `[mine, ...await next()]`, which yields registration order on the wire). The loop ([agent-loop source](../../../../packages/core/agent-loop/src/)) fires it once per loop instance, lazily before the instance's first `agent/pre-step`; the composed list is deep-cloned, deep-frozen, cached on the instance, and placed in front of the ENTIRE derived history — directly after the provider's system slot — on every request the instance sends ([wire order](../../../../docs/core-data-structures/core.md#the-request-envelope-llmcallconfig-and-the-logged-header)).

Three properties carry the design:

- **Request-only, header-logged.** `deriveMessages()` never returns the prefix; its one durable record is `EpochHeader.messagePrefix` on the instance's anchoring `request/header` snapshot — the channel the reconstructable-requests Agent Note already owns for the request's non-history half, so no new session event exists. The [`dsh-agent-loop/invariant`](../../../../packages/core/agent-loop/src/invariant.ts) companion recomputes `messagePrefix + boundary derivation` against every loop-built request; an unlogged prefix cannot reach the wire when that contribution is enabled.
- **Frozen per instance.** Reuse is structural, not disciplined: the cached product cannot change mid-session, so the provider's prompt cache holds by construction and the prefix extends the cacheable region at zero marginal cost per step. A process restart or `ctx.agents.resume()` is a new instance: it recomposes, and any drift lands attributably on the `'resume'` header snapshot. This is the routing rule the seam creates: session-frozen openers ride the prefix; content that changes mid-session rides the append-only history channels (`agent.inject()` or tool/prompt-submit `additionalContexts` — [the interception-seams Agent Note](2026-06-30-interception-seams.md)), each a durable `context/message` paid once and prefix-cached thereafter.
- **Exact in the durable request envelope.** Composition precedes the instance's first `agent/pre-step` and request boundary. The first routed request logs the current prefix on its header, so post-step token pressure reads the exact prefix together with the actual prompt, tools, and routed model; no compaction-only parameter is carried through the generic pre-step seam. A composition interrupted by cancel/dispose is discarded, never cached: an abort-aware listener's degraded fallback cannot leak into later requests, and the next turn recomposes under a live signal.

Because composition runs before the boundary snapshot, a composing listener's session append joins the CURRENT request's derived history. Compaction structurally cannot touch the prefix (or the system prompt): it rewrites surface nodes, and header state never enters the surface.

## Testing

[Interception tests](../../../../packages/core/agent-loop/tests/interception.spec.ts) pin compose-once reuse without changed headers, prepend order, empty-prefix omission, immutability, composition before pre-step, and the prefix on the routed header; [cancellation tests](../../../../packages/core/agent-loop/tests/cancel.spec.ts) pin discard and recomposition. Session, invariant, token-meter, and compaction tests cover header round trips, request reconstruction, and durable prefix-aware pressure accounting. Snapshot normalization preserves prefix counts, while the [pinned-header scenario](../../archived/testing/2026-07-06-pin-request-header-content-in-one-scenario.md) owns content and the default example remains prefix-free. The provider-independent seam needs no dedicated e2e; the with-key [request-cache e2e](../../../../packages/core/agent-loop/tests/request-cache.e2e.ts) covers its cache economics.

## Alternatives considered

- **Per-request `before`/`after` slots recomputed every step** (the shape first proposed: a waterfall firing on every request, contributing frozen `before` messages ahead of the history and fresh `after` messages behind it) — rejected. A per-step `before` recompose invites drift that must be logged as a full changed header, and an `after` slot sits behind the growing history, so its tokens re-pay on every request and everything after it is uncacheable. Measured against the alternatives, every current update pattern is served cheaper by a durable append (paid once, cache-read thereafter), and the only content with no home was the session-stable opener — which wants freezing, not recomputation.
- **A system-prompt section** (`system-prompt/assemble`) — rejected for this content: the assembly renders to the single `system` string, so message-shaped openers do not fit, and the system prompt is deliberately re-assembled per step (with a full changed header when it changes) while the opener wants instance-frozen semantics.
- **A durable history opener** (`inject()` at session start) — rejected: permanent history is the failure mode in the problem statement — replayed everywhere, compactable, stale across resumes.
- **Compose per turn instead of per instance** — rejected: a turn-boundary recompose either desyncs silently from the log or forces a changed header, and it busts the provider cache exactly as often as it fires; the legitimate refresh point is the instance boundary, where the `'resume'` snapshot already records drift attributably.
- **Carry prompt/prefix through `agent/pre-step` for provisional pressure** — rejected because it couples a generic lifecycle seam to one consumer and still misses later request routing and tools; post-step replay reads every request-envelope field from its durable routed header.
- **A dedicated session event carrying the prefix** — rejected: the header events are the request's non-history record by design; a second event would be a second home for the same fact and another codec to keep total.

## Consequences

- `agent/pre-step` stays a generic `(agent, turn, step, signal)` checkpoint. Compaction receives no prefix parameter; `ctx.tokenMeter` folds the prefix from the canonical routed header at post-step.
- A contributor whose content changes mid-session is not re-read until the next instance — by design. A deployment needing mid-session catalog updates routes the change notice through the append-only history channels and pays one durable `context/message`.
- The dropped `after` slot leaves no request-only channel near the request tail; nothing in the repo needs one, and adding it back would re-open the every-step re-pay cost the design exists to avoid.
- An empty composition is canonical absence: no-contributor deployments log no extra header bytes and their requests are the bare derivation.
