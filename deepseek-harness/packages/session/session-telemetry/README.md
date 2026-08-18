# @deepseek-ai/dsh-session-telemetry

English | [中文](README.zh.md)

The telemetry Service Definition declares the `SessionTelemetrySink` contract, and its capture coordinator passes session records to any reporting SDK backend that implements it. Capture can follow live session events or replay a canonical session-log prefix on demand. This package stops after it calls `emit()`: batching, retry, queueing, and loss policy belong to the backend's SDK and are neither specified nor wrapped. Rationale and rejected alternatives: [the revival Agent Note](../../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md), [feedback-gated delivery](../../../.agents/notes/implemented/feature/2026-08-05-feedback-gated-session-telemetry.md), and [buffer-free feedback replay](../../../.agents/notes/implemented/simplification/2026-08-06-buffer-free-feedback-telemetry.md).

## The backend contract

`SessionTelemetrySink` has three members: `emit(record)` MUST enqueue without blocking because it runs synchronously during `session/event` or explicit canonical-log replay; optional `flush()` is a fire-and-forget hint after a turn ends, and most backends omit it and use their SDK's normal batching schedule; `shutdown()` drains queued records and resolves when the SDK stops, and disposal awaits it. An implementation that provides `flush()` must order concurrent flushes with the final `shutdown()` drain. `SessionTelemetryBackend` registers this API under the `sessionTelemetry` context key; each context accepts one implementation, and a duplicate load throws. A backend constructs `SessionTelemetryCoordinator` with `live` or `on-demand` capture and calls `captureSession(session, throughSeq?)` at its chosen trigger.

The service also carries the required [`SessionTelemetrySharingStatus`](#the-sharing-disclosure) `sharing` member: the deployment-selected sharing policy every backend must disclose to human-facing acknowledgement surfaces (the `/feedback` command's confirmation). A consumer renders "not configured" only when no telemetry service is mounted. The seam owns the vocabulary (`full` | `feedback-only` | `disabled`) so any backend can disclose a policy without depending on the OTel package.

## The sharing disclosure

The acknowledgement of a recorded feedback entry reports whether and how the session is shared, read from the mounted backend's `sharing`. A backend sets the property from its deployment configuration: `full` (every event is handed over as it happens), `feedback-only` (nothing is handed over until a `feedback/record` event releases the unreleased prefix through it), or `disabled` (nothing is handed over at all). Consumers map the status onto user-facing copy; the disclosure never claims delivery — handoff is the non-blocking enqueue, and batching, retry, and loss policy stay the backend SDK's.

## Capture points

In `live` mode the coordinator registers, all through the composing fiber's effects: `session/created` (adopt: record the header, read the log back through the projection from the construction boundary — constructor seeds from fork/resume never re-emit on the firehose and never re-export), `session/event` (project, deep-copy, redact, then hand off; zero I/O), `session/flush` (forward the optional `flush()` hint and return void — the loop's awaited parallel must never wait on telemetry), `session/disposed` (capture the session's `shutdown` operational record at its termination edge, then retire it), `agent/error` (the one live-bus relay; the session event vocabulary intentionally has no operational-error record), a dispose effect (capture shutdown for each still-live session, then await the backend's `shutdown()`; failures warn instead of throwing), and an adoption sweep of `ctx.sessions.list()` (a hot reload does not replay `session/created`). In `on-demand` mode it registers only the dispose effect: `captureSession()` reads the canonical log through an optional inclusive sequence boundary, while flush hints and operational events remain local.

## The redact waterfall

Every record passes the `sessionTelemetry/record` waterfall immediately after projection — the Service Definition's scrubbing extension point. This package ships NO rules of its own: the innermost `next()` passes the record through unchanged, so with no listener mounted records reach the backend exactly as captured, and exported data is precisely as clean as the rules a deployment mounts. Listeners stack by transforming `next()`'s return value; returning without `next()` replaces everything beneath, and a throwing listener withholds that one record fail-closed inside the coordinator's containment. Live capture runs the waterfall at append time; on-demand capture runs it while replaying the canonical log, using the rules mounted at that time. Redaction applies to the outbound copy only; the canonical session log is never rewritten.

## The handoff cursor

A module-scope `WeakMap<Session, seq>` marks the highest seq HANDED OFF (not delivered) per session. Live capture advances it at append time; on-demand capture advances it only while `captureSession()` hands a requested prefix to the backend. An uncaptured prefix remains solely in the canonical log, so a coordinator reload adds no telemetry-owned recovery state. On replay the coordinator re-hands only events past the cursor (events at or below it still rebuild the chunk-projection state); a missing cursor safely degrades to a re-hand from the session's construction boundary (`Session.firstLiveSeq` — seq 0 for a session born in this process), absorbed by receiver-side dedupe on `(session.id, event.seq)`. Constructor seeds never re-export: a resumed session's history shipped from the previous process under the same id, and a fork's inherited prefix lives in the parent's stream (receivers stitch on `session.parent_id` + `session.seed_length`). The accepted cost, consistent with at-most-once delivery: a resume does not backfill records a previous process failed to deliver — a deployment with a backfill requirement needs the deferred outbox, not replay. This is a deliberate, narrow exception to the registrations-are-effects discipline: entries die with their sessions, the value is a monotonic watermark, and losing it is never an error.

## The fixed chunk projection

Only the first `assistant/chunk` of each `(turn, step)` ships; the rest are dropped at capture and never advance the cursor. That one chunk is the stream-started signal: `step/start` + first-chunk presence + `assistant/message` presence + the `turn/end` reason distinguish "the request never started" from "the stream died midway" without chunk volume, and time-to-first-token stays computable. Chunk elision makes `seq` gaps routine on the wire — a gap is never a loss signal. Every other event type, including ones merged by plugins this package never heard of, passes through whole.

## The logical record

`SessionTelemetryRecord`: `channel` (`ledger` | `ops`), `time` (epoch ms), `severity` (pre-mapped: ERROR for `tool/result.isError`, `turn/end` error reasons, and `agent-error`; INFO for other captured records, while `sessionTelemetry/record` policies may assign WARN), identity-only `attributes` (`session.id`, `event.type`, `event.seq`, plus `session.cwd`/`session.parent_id`/`session.seed_length` when the header has them), and the complete deep-copied `event.data` as `body` — post-redaction. Operational records carry `sessionTelemetry.op` (`agent-error` | `shutdown`) and `session.id`, and deliberately NO `event.seq`/`event.type` — signals to alert on, not entries to sum; `agent-error` normalizes its arbitrary thrown value into a stable `{ name, message }` body. Delivery downstream of the handoff is the backend SDK's; duplicates remain possible (cursor-less re-adoption, SDK retries), so receivers dedupe on `(session.id, event.seq)`.

## Model Experience

None, as this package only observes the session stream and hands redacted copies to a reporting backend; it never contributes to a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Best-effort delivery** — the cursor marks handed-off, not delivered; a session torn down inside a reload window cannot be re-adopted; whatever sits in a backend queue at crash time is lost. A durable outbox (spool, per-sink cursors, at-least-once) is deferred until a deployment states a crash-loss requirement — see [the revival Agent Note](../../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md).
- **No built-in redaction rules** — with no `sessionTelemetry/record` listener mounted, records leave the process exactly as captured, including any credentials embedded in file contents or command output; a deployment exporting to a shared collector owns its rule set.
- **On-demand redaction uses current state** — uncaptured events exist only in the canonical session log. A later `captureSession()` deep-copies and redacts their current values with the policy mounted at that time; there is no capture-time telemetry snapshot or durable pre-capture spool.
