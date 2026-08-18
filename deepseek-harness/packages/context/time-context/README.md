# @deepseek-ai/dsh-time-context

English | [中文](README.zh.md)

Opt-in durable context with the current zoned time, the browser zone attached to the open request, and elapsed time sampled during model-request preparation. Default compositions leave it disabled; the Schedule Web overlay mounts it so the model can interpret otherwise-unqualified dates and times in the user's browser zone. Decision record: [the durable time-context Agent Note](../../../.agents/notes/implemented/feature/2026-07-16-durable-per-step-time-context.md).

## Config

```yaml
- id: time-context
  name: '@deepseek-ai/dsh-time-context'
  config:
    timeZone: Asia/Shanghai  # optional fallback when the request has no unique browser zone
    refreshIntervalMs: 60000 # optional; omit or set to 0 for every eligible attempt
```

When the open turn contains one Host-validated browser zone, that request-local zone formats the timestamp. With missing or mixed browser provenance, `timeZone` supplies the display fallback; omitting it resolves the Node process zone once at plugin load. Node honors `TZ`, and every explicit fallback is validated through `Intl.DateTimeFormat`.

`refreshIntervalMs` must be a non-negative safe integer. Omission or `0` adds context to every eligible entering pre-step whose signal is not already aborted. A positive value adds it only when the Session has no earlier time-context injection, wall time moved backward, or at least that many milliseconds elapsed since the latest injection.

## Request-zone ownership

The browser samples `Intl.DateTimeFormat().resolvedOptions().timeZone` for each prompt. The Host validates and canonicalizes that value before binding it to the exact durable `user-rpc` message source. Time-context examines only those sources in the open turn: one unique zone resolves the request, multiple zones are `mixed`, and none are `unavailable`. It does not read or mutate Session headers, connection state, or Schedule records.

The resolved instruction tells the model to interpret otherwise-unqualified dates and times in that browser zone. Mixed or unavailable provenance tells the model to ask the user to clarify. This is natural-language context, not an input default at another package boundary: a tool that accepts local calendar fields still owns its explicit zone requirement.

## Timing semantics

The plugin prepends an `agent/pre-step` listener and delegates first. When an injection is due and the downstream decision enters, it appends one sourced `UserMessage` to the returned batch. AgentLoop records the final batch after `step/start` and before request derivation. Rejection, listener failure, or an already-aborted signal records nothing.

Each reading uses the exact snapshot source `{ kind: 'plugin', plugin: 'time-context', form: 'snapshot', sections: [{ name: 'time-context', text: <same text> }] }`. The `./invariant` companion validates that shape, re-derives the current-turn browser policy from the original `user-rpc` messages, and checks the timestamp zone and elapsed baseline.

Positive-interval scheduling scans raw durable Session events for the latest plugin-attributed message, including a reading shadowed by compaction. It therefore survives resume without a process-local cache. A positive interval can intentionally let a later request reuse existing history without a fresh reading; the Schedule Web overlay omits the interval.

Step 1 measures from the latest preceding durable user, assistant, or tool-result message. The prompt proposed for that step has not been appended yet. Later steps measure from the preceding time-context event in the same turn. Missing baselines report `unavailable`, and backward wall-clock movement clamps elapsed time to zero.

A reading records an entered step, not a completed or transmitted request. A later preparation failure can leave it in history. The message remains in derived conversation history until compaction shadows it; `request/header` contains no time-context state, and request reconstruction uses the complete durable surface prefix after each `step/start`.

## Model Experience

### Preparation-time temporal context

#### What the model sees

Each injected message contains three lines. `<timestamp>` is an ISO-shaped timestamp with numeric offset and IANA zone; durations use compact whole-second units.

##### First step

```markdown
Time sampled while preparing turn <turn>, step 1: <timestamp>
Browser time zone for this request: <iana-zone-or-mixed-or-unavailable-policy>.
Elapsed since the preceding model-visible message: <duration-or-unavailable>.
```

##### Later steps

```markdown
Time sampled while preparing turn <turn>, step <step>: <timestamp>
Browser time zone for this request: <iana-zone-or-mixed-or-unavailable-policy>.
Elapsed since the preceding step context: <duration-or-unavailable>.
```

#### Token effect

Each reading accumulates until compaction shadows it. A positive interval reduces additions; omission or `0` adds one at every eligible preparation attempt.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Prompt provenance only** — browser-zone context guides natural-language interpretation but does not silently supply another tool's required zone field.
- **Mixed turns ask** — if one open turn contains prompts from different browser zones, the model is told to clarify rather than guess which one owns an unqualified time.
- **Fallback is not user authority** — the configured or process zone formats the clock when browser provenance is missing or mixed, but the model-facing policy still says to clarify.
- **Whole-second display** — timestamps and durations omit sub-second precision even though durable event times retain milliseconds.
- **History cost between compactions** — omission or `0` retains one reading for every eligible attempt; a positive interval reduces but does not eliminate this cost and may leave a later request without fresh browser-zone guidance.
