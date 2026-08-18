# session/ — durable session data plane

English | [中文](README.zh.md)

The durable family around `core/session`'s live in-memory service: the persistence seam with its storage backends and checkpoint policy, the projection seam that serves whole log-derived values, log-backed titles, and outbound session telemetry. All **product** packages. `session-query/` remains a sibling group: the read/tool surface is consumed independently of persistence internals.

## Persistence

Durable session persistence, semantic checkpoint policy, and the shipped storage backends.

| Package | Role | ctx key |
|---|---|---|
| [`session-persistence/`](session-persistence/README.md) | Defines the persistence service and shared write coordination | `ctx.sessionPersistence` |
| [`session-checkpoint-policy/`](session-checkpoint-policy/README.md) | Applies semantic durability checkpoints | wraps `ctx.llm` and `ctx.tools` |
| [`session-persistence-jsonl/`](session-persistence-jsonl/README.md) | Persists sessions in JSONL files | registers on `ctx.sessionPersistence` |
| [`session-persistence-sqlite/`](session-persistence-sqlite/README.md) | Persists sessions in SQLite | registers on `ctx.sessionPersistence` |

The [session-persistence decision](../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md) records the persistence design.

## Projection

Serves current, log-derived per-session state to client carriers.

| Package | Role | ctx key |
|---|---|---|
| [`session-projection/`](session-projection/README.md) | Defines and drives session projection units | `ctx.sessionProjections` |
| [`session-projection-cache/`](session-projection-cache/README.md) | Persists and restores projection checkpoints | `ctx.sessionProjectionCache` |
| [`session-stats/`](session-stats/README.md) | Serves whole-log conversation counts and wall times (`sessionStats` unit) | registers on `ctx.sessionProjections` |

## Titles

Derives durable session titles from the session log, with an optional model-backed provider.

| Package | Role | ctx key |
|---|---|---|
| [`session-title/`](session-title/README.md) | Owns title state, fallback behavior, provider registration, and refresh | `ctx.sessionTitle` |
| [`session-title-llm/`](session-title-llm/README.md) | Provides shared model-backed title generation | — |
| [`session-title-first-prompt-llm/`](session-title-first-prompt-llm/README.md) | Titles a session from its first eligible human message | registers on `ctx.sessionTitle` |
| [`session-title-all-prompts-llm/`](session-title-all-prompts-llm/README.md) | Titles a session from all eligible human messages | registers on `ctx.sessionTitle` |

Deployments may register one model-backed provider; the service retains a deterministic fallback when none is present.

## SessionTelemetryBackend

Projects session activity into outbound telemetry and delegates delivery to a configured reporting backend. The [telemetry decision](../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md) records the reporting boundary; the [mode decision](../../.agents/notes/implemented/feature/2026-08-05-feedback-gated-session-telemetry.md) records immediate, feedback-gated, and disabled delivery.

| Package | Role |
|---|---|
| [`session-telemetry/`](session-telemetry/README.md) | Defines capture, redaction, projection, and live or on-demand backend delivery. |
| [`session-telemetry-otel/`](session-telemetry-otel/README.md) | Delivers telemetry through OpenTelemetry logs in `FULL`, `FEEDBACK_ONLY`, or `DISABLED` mode. |

The subsystem references: [persistence.md](../../docs/subsystems/persistence.md), [session-projection.md](../../docs/subsystems/session-projection.md), [session-title.md](../../docs/subsystems/session-title.md), and [session-telemetry.md](../../docs/subsystems/session-telemetry.md). Only one title provider may register at a time; the demo spine mounts the fallback service and leaves both model providers out of default composition.
