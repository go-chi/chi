# @deepseek-ai/dsh-session-telemetry-otel

English | [中文](README.zh.md)

The OpenTelemetry backend for [the telemetry seam](../session-telemetry/) — the only entry a deployment loads. Its `mode` decides whether the seam follows session events live, replays the canonical log only at recorded feedback, or keeps telemetry local. Uploading modes compose the OTel JS SDK as-is (`LoggerProvider` → `BatchLogRecordProcessor` → OTLP/HTTP log exporter) and map each handed-over record onto `logger.emit()`, under two instrumentation scopes: ledger records on `@deepseek-ai/dsh-session-sessionTelemetry-otel`, operational records on `@deepseek-ai/dsh-session-sessionTelemetry-otel/ops`. Resource identity contains `service.name`/`service.version` from `dsh-llm`'s `APP_IDENTITY` plus this package's anonymous `user.id` (`$DSH_HOME/.anonymous-user-id`, a random UUID created on first use and reset by deleting the file), carried once per export batch rather than per record.

## Config

```yaml
- id: sessionTelemetry-otel
  name: '@deepseek-ai/dsh-session-sessionTelemetry-otel'
  config:
    mode: FULL                # explicit opt-in; default: DISABLED
    shutdownTimeoutMillis: 3000 # optional; defaults to 3000
    exporter:                # passed verbatim to the SDK's OTLP/HTTP log exporter
      url: https://collector.example.com/v1/logs
      headers:
        authorization: !!js `Bearer ${process.env.OTLP_TOKEN}`
    processor: {}            # optional; passed verbatim to BatchLogRecordProcessor
```

| `mode` | Behavior |
|---|---|
| `FULL` | Each projected record, including lifecycle ops records, is handed to the OTel SDK immediately. |
| `FEEDBACK_ONLY` | Each `feedback/record` replays, projects, and redacts the canonical session-log suffix through that event. Later records wait for another feedback event and remain local if none arrives. |
| `DISABLED` | Default. No coordinator, provider, processor, or exporter is constructed. No telemetry record leaves the process. A `feedback/record` logs `session sessionTelemetry is DISABLED; nothing will be shared and this feedback remains local`; the event remains in the local session log. |

Programmatic TypeScript configuration uses the exported `SessionTelemetryMode` enum (`SessionTelemetryMode.FULL`, `SessionTelemetryMode.FEEDBACK_ONLY`, or `SessionTelemetryMode.DISABLED`); raw string literals are not assignable. Serialized Cordis configuration continues to use the string values shown above.

Upload authorization is positive and fail-closed. An unknown direct-construction mode fails before transport configuration is read. Only `FULL` accepts direct `ctx.sessionTelemetry.emit()` calls. `FEEDBACK_ONLY` gives its on-demand coordinator a private backend capability and treats only the exact `feedback/record` object already stored at `session.events[event.seq]` as consent; an independently emitted bus value is ignored. `DISABLED` never constructs the SDK pipeline, even when exporter options are present.

The mounted service discloses the resolved mode through the seam's [`SessionTelemetrySharingStatus`](../session-telemetry/README.md#the-sharing-disclosure) `sharing` property (`full` / `feedback-only` / `disabled`), so the `/feedback` acknowledgement can report whether and how the session is shared. The disclosure is set in the constructor and is independent of capture: even `DISABLED` discloses `disabled`.

`exporter.url` is required in `FULL` and `FEEDBACK_ONLY`, has no default, and must parse as `http(s)`; it is optional and unused in `DISABLED`. In uploading modes, `shutdownTimeoutMillis` is a positive finite DSH-owned outer deadline that defaults to 3000 ms, and a non-positive-integer `processor.maxExportBatchSize` also fails at plugin load because the SDK accepts it but then hangs on shutdown. Both SDK blocks pass through whole: every `OTLPExporterNodeConfigBase` field (`headers`, `timeoutMillis`, `compression`, `keepAlive`, …) reaches the exporter, and batching, export cadence (`scheduledDelayMillis`), retry, queue bounds, and loss policy under sustained failure are SDK behavior tuned through `processor`. The backend implements no `flush()`: the batch processor owns ordinary flushing. During shutdown, OTel awaits `exporter.forceFlush()` before the processor's `exportTimeoutMillis`-bounded completion promise; if that transport promise never settles, this package abandons the wait at `shutdownTimeoutMillis`, logs the contained shutdown failure through the coordinator, and lets application teardown continue. The deadline cannot cancel the SDK transport, so records still pending then may be lost at process exit.

## What leaves the machine

In uploading modes, records carry the complete `event.data` as the seam's `sessionTelemetry/record` waterfall returns it — user and assistant message content, tool arguments and results (command output, file contents), the full system prompt and tool schemas (`request/header`), todo text, compaction summaries, hook `stderrSummary`, feedback text, and the session `cwd` (a local path). The seam ships no redaction rules: with no `sessionTelemetry/record` listener mounted, that is the raw captured copy, so a deployment exporting beyond a trusted boundary mounts its own rules (see [the seam README](../session-telemetry/README.md#the-redact-waterfall)). `FULL` runs redaction at append time; `FEEDBACK_ONLY` retains no telemetry copy and runs the currently mounted rules when feedback triggers canonical-log replay. Provider credentials never appear regardless: adapter API keys are constructor parameters, not session events, so they are structurally absent from the log and therefore from telemetry. `DISABLED` does not construct the SDK pipeline or hand any capture to a backend.

## Field mapping

Seam record → SDK log record: `time` → `timestamp`/`observedTimestamp`; `severity` → `severityNumber`/`severityText` (INFO 9 / WARN 13 / ERROR 17); `body` → the structured log body; `attributes` verbatim. Receivers dedupe on `(session.id, event.seq)` and alert on severity. In `FULL`, they may also detect crashes by `shutdown`-record absence: the marker is emitted at the session's own disposal or application teardown, and a marker followed by more events is a telemetry reload. In `FEEDBACK_ONLY`, a released prefix normally has no later `shutdown` marker, so its absence is not a crash signal. Streams are not self-contained across lineage: a resumed session continues its own id's stream from where the previous process left off, and a forked session's stream starts at its inherited boundary — its prefix lives in the parent's stream, stitched via `session.parent_id` + `session.seed_length`. A resumed local log may contain synthetic closers that were never exported; the wire stream stays faithful to records actually handed to the SDK.

## Model Experience

None, as the backend only forwards the seam's redacted records into the OTel SDK pipeline; it never contributes to a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Upstream experimental tree** — `@opentelemetry/sdk-logs` is still published from the upstream experimental tree; SDK API churn lands here and only here — the seam contract does not move.
- **Live-collector behavior belongs to the SDK exporter** — authentication, TLS, throttling, and other real OTLP deployment behavior follow the upstream SDK rather than a package-owned compatibility layer.
- **Feedback-time snapshot** — `FEEDBACK_ONLY` retains no telemetry-owned copy before feedback. It reads and redacts the current canonical log when feedback is recorded; a crash before feedback uploads nothing, and policy changes before feedback affect what that replay exports.
