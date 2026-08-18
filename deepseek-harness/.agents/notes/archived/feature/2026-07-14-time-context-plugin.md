# Agent Note: Optional time-context plugin

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-14-time-context-plugin.zh.md)

## Problem

The dynamic system-prompt storage and refresh decision in this record is superseded by [Durable per-step time context](2026-07-16-durable-per-step-time-context.md). The opt-in package, zoned formatting, and validation remain; the follow-up owns the current model-visible and durability contract.

An agent request has no live clock unless a deployment puts one in prompt text or gives the model a query tool. Static text becomes stale, while a tool call adds overhead to ordinary reasoning about dates, deadlines, or idle time. Without elapsed time, the model cannot distinguish an immediate follow-up from one sent hours after the preceding message.

Prompt assembly can derive both facts per step from durable session timestamps, and request-header logging can record the exact rendered value. Accumulating stale readings in conversation history or waking idle agents would violate the existing request lifecycle.

## Decision

`@deepseek-ai/dsh-time-context` is an opt-in function plugin at `packages/context/time-context/`. The `context/` product group holds bounded request-context enrichments that define neither a tool nor a service. `dsh-agent-spine-demo` and shipped examples do not load the package; deployments mount it explicitly when its token and disclosure costs are acceptable.

The plugin registers the global `context:time` system-prompt section at order 10, after the deployment persona and before tool guidance. For an active turn it emits an ISO-shaped timestamp with numeric UTC offset and IANA zone, plus a compact whole-second duration since the last model-visible message before the turn opened. Bare and idle assemblies receive an empty section.

### Previous-message baseline

At a turn's first assembly, the provider scans before `turn/start` for the latest `user/message`, `assistant/message`, `tool/result`, `context/message`, or `steering/message`. It excludes the current prompt so the duration expresses the inter-turn gap instead of approximately zero. Every refresh in that turn keeps the same baseline, and the first turn reports `unavailable (no earlier message in this session)`.

The baseline is the session event's append time, not an unlogged client timestamp. Resume and fork behavior are therefore deterministic from the durable log, and the model-visible value remains reconstructable without a new event. A backward wall-clock adjustment clamps the duration to zero.

### Refresh policy

`refreshIntervalMs` defaults to 60,000 and must be a non-negative safe integer. Every turn's first request refreshes. Later assemblies in that turn reuse the block until its age reaches the interval; `0` refreshes every step. No timer creates work during model calls, tools, or idle time because refresh is request-bound.

When `timeZone` is omitted, `Intl.DateTimeFormat` resolves the Node process's system zone once at plugin load. Node honors `TZ`; without that override, the host or container supplies the zone. An explicit value must be an IANA identifier and is validated at load. The captured zone remains stable until plugin reload, and the ISO-shaped local timestamp includes its current numeric offset so daylight-saving changes stay explicit. This is the deployment process's zone, not a remote user's zone.

### Logging and token shape

The loop records the temporal block in full `request/header` snapshots before transmission, satisfying the [reconstructable-requests contract](../architecture/2026-07-05-reconstructable-requests.md). Each request carries one current block; earlier readings do not remain in conversation history. The plugin owns the fact and contributes it through the prompt registry, following the [prompt-variables Agent Note](../architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md) without a loop special case.

## Testing

Unit tests pin formatting, baselines, refresh policy, validation, per-agent state, disposal, and load-time system-zone capture. A real agent-loop test pins the transmitted prompt and full `request/header` snapshots. A keyless subprocess e2e boots a test-only `cordis.yml` through the real Loader and stdio app, omits `timeZone` under a controlled `TZ`, drives two turns, and verifies the persisted request headers externally. Default snapshot compositions omit the plugin, so their transcript fixtures contain no temporal block.

## Alternatives considered

- **Append a `context/message` on every turn or refresh** — rejected because readings and token cost would accumulate in history. Replacing a prior surface node would preserve its old position, while replacing the tail would hide intervening conversation.
- **Use `agent/session-prefix`** — rejected because the session-stable prefix cannot represent a per-turn or per-step clock.
- **Mutate requests in `agent/request`** — rejected because that seam shapes call config after the message boundary; inserted model content would bypass prompt-pressure accounting and request-header logging.
- **Register separate `{{current_time}}` and `{{elapsed}}` variables** — rejected because independent providers can sample different instants and require shared caching. One section records the pair atomically without a deployment-authored template.
- **Refresh from a background timer** — rejected because a new value has no consumer outside request assembly. Timer-driven `agent.inject()` would create turns and wake idle sessions merely to report time passing.
- **Keep UTC as the omitted default** — rejected because an explicitly enabled clock should follow its deployment environment unless the operator chooses UTC. `timeZone: UTC` remains available when a deployment requires it.
- **Add a time-zone detection library** — rejected because Node's `Intl` runtime already exposes the process's IANA zone. Another dependency cannot infer a remote user's zone either.
- **Mount the plugin in `dsh-agent-spine-demo`** — rejected because time zone, disclosure, token budget, and freshness are deployment policy. Opt-in keeps default context stable.
- **Place the package in `core/`** — rejected because `core/` owns the product API spine, while this plugin is an optional leaf with no service key.

## Consequences

- Opted-in models receive a zoned clock and inter-turn duration without a tool call. The system-prompt cost is fixed per request instead of growing with the session.
- An omitted `timeZone` follows the process's `TZ`, host, or container zone as observed at plugin load. Operators must configure an explicit zone when the deployment environment does not represent the intended user.
- A refresh changes the request header and can add a full `request/header` snapshot with reason `change`. `refreshIntervalMs` trades freshness against the number and size of durable full snapshots; `0` records a new value on every step whose whole-second rendering changes.
- No request exists solely to refresh time. A long-running tool leaves the prior reading until the next step assembles.
- Duration reflects harness processing time at durable append boundaries, not client-network latency before logging. Preserving a client-origin timestamp requires a separate durable input contract.
