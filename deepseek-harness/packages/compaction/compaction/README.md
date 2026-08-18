# @deepseek-ai/dsh-compaction

English | [中文](README.zh.md)

The **`CompactionEngine`** (`ctx.compaction`) defines WHAT compaction does — decide when history is too large and summarize an older range into a single surface node — without saying HOW.

This package owns the Service Definition role of the compaction capability, split so each role evolves (and swaps) independently:

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-compaction` (this) | Service Definition: abstract service + `compaction/*` events + `CompactionResult` + correlated checkpoint-source constructor + tool-pairing boundary helpers |
| `@deepseek-ai/dsh-compaction-basic` | Service Provider: `ctx.tokenMeter` pressure + token-budget retention + `llm.stream()` summarization |
| `@deepseek-ai/dsh-command-compact` | Consumer: the human `/compact` command over `ctx.compaction.compactNow()` |

Unlike the bash seam, this Service Definition depends on `@deepseek-ai/dsh-session` and `@deepseek-ai/dsh-llm` — the contract's verbs are defined over a `Session` and its output is the `ContentBlock` vocabulary, so they cannot be expressed without naming those packages. That deviation from the "Service Definition depends only on cordis" guidance is intentional and recorded in the [compaction capability-seam Agent Note](../../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md).

## Service API (`ctx.compaction`)

All three operations are **abstract** — the backend owns trigger policy, retention, event sequencing, and summarization. Reusable request measurement is a separate service, [`ctx.tokenMeter`](../../llm/token-meter/README.md), rather than part of this Service Definition.

| Member | Semantics |
|---|---|
| `compactIfNeeded(agent, trigger, signal)` | Consider automatic compaction for `trigger: 'pressure' \| 'context-overflow'`. A pressure trigger may apply the backend's threshold and retained-tail policy; a confirmed overflow may force a useful balanced reduction. Returns the `CompactionResult`, or `null` when no safe range exists. A backend's summarization request is a direct `ctx.llm.stream()` call (not a loop step), so per-call interception happens at `llm/stream`. |
| `compactNow(agent, signal)` | Explicitly compact one useful balanced older span even below automatic pressure. It synchronously reserves idle turn admission before yielding, writes nothing when no useful span exists, records a standalone `compaction/* { turn: null }` attempt before summarization, and awaits its durability checkpoint before release. Expected operational failures use `ManualCompactionError`; cancellation rethrows the exact abort reason. |
| `compactRegion(start, end, agent, signal?)` | Forcibly summarize surface nodes `[start, end]` (inclusive seqs) from `agent.session` into a single replacement node whose source comes from `compactCheckpointSource(compactionId)`. **Throws** if a compaction is already in progress, if `start`/`end` aren't surface nodes, or if `start` is positioned after `end` on the surface. The range is a SURFACE-POSITION span, not a numeric seq interval — after a prior replace lands a fresh high-seq summary node at the shadowed range's position, surface order no longer tracks seq order. |

`CompactionResult` keeps the raw summary and bookkeeping-event seqs available to callers alongside the shadowed range and token accounting; its drift-checked shape lives in the [compaction data-structure reference](../../../docs/subsystems/compaction.md#compactionresult).

`compactIfNeeded` and `compactNow` take a required `signal`; `compactRegion`'s is optional. A backend that summarizes via `ctx.llm.stream()` **must** forward it into the call's `GenerateOptions.signal`, so an abort or fiber dispose tears down the in-flight summarization. Automatic and explicit-region brackets recover their numeric owner from the currently open turn. Manual brackets require no open turn and stamp `turn: null`.

`ManualCompactionError.code` is the closed set `busy | changed | summary | commit | persistence`. `changed` and `summary` mean the selected conversation surface was not replaced, but their failed attempt is still recorded in the session log. `commit` is deliberately neutral about partial mutation, and `persistence` means the in-memory bracket closed but its explicit flush failed.

## Tool-pairing boundaries

The Service Definition exports `toolPairingBalancedBefore(session, seq)` and `toolPairingBalancedAfter(session, seq)` for snapping and validating compaction edges. A safe edge has no unanswered assistant tool call crossing it. Each helper validates that the event sequence is in the current surface and answers from balances cached per cut in surface order.

The private per-session cache is keyed by `session.surface.replaceGeneration` and the processed surface-entry count. An unchanged generation extends the fold with unseen tail entries only; a log-only append with no new surface entry does no event reads, while a replacement generation rebuilds current membership and balances. Missing event seqs and a `tool/result` without a preceding open call reject as corrupt surface state.

## Surface contract

`SurfaceEventType` is a closed union — only `user/message`, `assistant/message`, and `tool/result` may carry `surfaceOp`. A `compaction/*` event therefore **cannot** appear on the surface. A successful compaction instead:

1. appends `compaction/start` (log-only) — acquires the lock,
2. summarizes the range,
3. appends `compaction/summary` (log-only) with the summary, range, shadowed seqs, token count, and provider/model call envelope,
4. appends a single `user/message` with `source: compactCheckpointSource(compactionId, sourceCommandId?)` and `surfaceOp: { op: 'replace', start, end }` carrying the summary — **the only surface mutation in this operation**,
5. appends `compaction/end` (log-only) — releases the lock.

The surface mutation (step 4) sits **inside** the lock bracket: `compaction/end` is the last event, so the lock is never released before the mutation lands. A crash between `compaction/start` and `compaction/end` therefore leaves a detectable orphaned lock (a `compaction/start` with no matching `compaction/end`) rather than a `compaction/end` that falsely claims compaction finished while the surface was never shadowed.

The marker pair names lock acquisition and release, not an exclusive event container. An idle `inject()` may append unrelated context between a manual start and end while summarization is pending. Manual stability therefore revalidates the selected span rather than demanding whole-surface equality; the positional replacement leaves that injected context visible after the checkpoint. Automatic compaction keeps whole-surface equality inside its active turn.

`deriveMessages()` then renders the summary as a user-role message followed by the retained nodes. The shadowed events remain in the raw log, so replay is deterministic.

## Blocking

Compaction is serialized by one log-recorded lock shared by all entry points. Tail inspection independently finds the latest unmatched `compaction/start` and the newest `session/end-seed`. An unmatched start after that boundary is live and reports `busy`; an older unmatched start is stale evidence from a prior process lifecycle and does not block. The same end-seed transition clears the invariant companion's replay trace. A live bracket cannot cross a `turn/start` or `turn/end`; during adoption, repair boundaries in the inherited prefix remain replayable when the later end-seed proves their open bracket stale.

The lock is the durable bracket, not a `WeakSet`, wrapper mutex, or client-side anchor. `compaction/start` is appended synchronously before summarization yields. Every later failure makes exactly one `compaction/end { error }` attempt; if that close append itself fails, the unmatched start remains the intentional busy signal and no flush is attempted. A successfully closed manual attempt is flushed even when it reports `changed` or `summary`, preserving the recorded attempt before turn admission is released.

## Events

The `compaction/*` events extend `SessionEventMap` (merge-extensible) via declaration merging — they are session events, not cordis `Events`, and all three are log-only (no `surfaceOp`). Per-event payloads and semantics are in the generated [persistence log event catalog](../../../docs/persistence-catalog.md).

## Implementing a backend

Subclass `CompactionEngine`, implement `compactIfNeeded`, `compactNow`, and `compactRegion`, and load the subclass as a plugin — it registers as `ctx.compaction`. Every successful backend creates its replacement user message source with `compactCheckpointSource(compactionId, sourceCommandId?)`; the required `compactionId` correlates the checkpoint with its `compaction/*` transaction, while `isCompactCheckpointSource()` recognizes the marker after persistence or cloning without depending on backend identity. A template- or model-backed implementation can live as a sibling package without changing callers or the shared token meter.

## Recognizing a checkpoint outside the host program (`./checkpoint`)

`compactCheckpointSource()`, `CompactionCheckpointSource`, and `isCompactCheckpointSource()` are declared on the `@deepseek-ai/dsh-compaction/checkpoint` subpath and re-exported from the root, so host-side consumers keep reading them from the root. The constructor requires the owning `CompactionId`, preventing backends from writing an uncorrelated marker that the package invariant must reject. The leaf imports no cordis and declares no module augmentation (the [`dsh-commands/brand`](../../interaction/commands/README.md) shape), which is what lets a client or wire program name the checkpoint source: the package **root** cannot enter such a program at all, because it reaches `dsh-session`'s root and that `Context` merge declares the host `sessions` service against the client's own (`TS2717` — one program per side, per [development.md](../../../docs/development.md#typescript-project-layout)). The web client's transcript adapter pins its plugin literal to the leaf's source type, so renaming the plugin id there is a compile error here.

## Model Experience

### Conversation history, when a backend is invoked

#### What the model sees

A successful implementation replaces an older surface range with one user-role summary checkpoint — a `user/message` carrying `surfaceOp: { op: 'replace', start, end }`; the raw events stay logged but stop appearing in derived model messages. The seam itself performs no rewrite.

#### Token effect

Zero direct tokens from this Service Definition. A backend trades many retained history tokens for one summary and leaves the recent tail unchanged.

#### KV Cache effect

A successful backend replacement invalidates reuse from the first shadowed history token; the seam itself does not alter a request.

## Known Limitations and Deferred Work

- **Human command, not a model tool** — `@deepseek-ai/dsh-command-compact` exposes argument-free `/compact` through `ctx.commands`; no model-facing compaction tool is registered.
- **Some single-unit overflow is out of contract** — balanced summary compaction cannot split one indivisible unit. The optional pruning companion can still repair a closed tool pair when text-bearing tool-result bulk is removable; a large non-tool node or a tool unit whose non-prunable remainder is oversized cannot be compacted.
- **An envelope that alone approaches the window is not surface-compaction work** — compaction shrinks derived history, never the system prompt, tools, or session prefix.
