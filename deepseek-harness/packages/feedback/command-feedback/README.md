# @deepseek-ai/dsh-command-feedback

English | [中文](README.zh.md)

Trigger-independent session feedback plus human-facing `/feedback` capture. The package exports `recordFeedback(session, text)`, which appends one log-only `feedback/record` event. Its plugin registers one global command through [`ctx.commands`](../../interaction/commands/README.md), so every composed command adapter discovers it; the shipped Web client executes it without a model turn.

## Command contract

| Input | Result |
|---|---|
| `/feedback <text>` | Append `feedback/record` and acknowledge with `Feedback recorded for session {sessionId}`, `Anonymous user: {userId}`, plus the session-sharing disclosure. |
| `/feedback` | Return a direct usage error. Whitespace-only input is treated as empty. |

Surrounding whitespace is discarded, but feedback is otherwise unparsed: no truncation, case folding, or control words. Text that looks like another command, such as `/feedback /plan felt slow`, is feedback content. Repeated commands each produce their own event; nothing is replaced or merged.

## Session-sharing disclosure

The acknowledgement names the receiving session id and reports how that session is shared, read from the mounted [`telemetry`](../../session/session-telemetry/README.md) service through the plugin context (`ctx.get('telemetry')`, never a declared injection). The disclosure is one sentence chosen from the backend's [`SessionTelemetrySharingStatus`](../../session/session-telemetry/README.md):

| Disclosed status | Acknowledgement sentence |
|---|---|
| `full` | `Session sharing is enabled.` |
| `feedback-only` | `Session sharing is feedback-gated; recording feedback releases the session prefix for sharing.` |
| `disabled` | `Session sharing is disabled.` |
| no service | `Session sharing is not configured.` |

The disclosure states the deployment's current sharing policy only; it never promises delivery or retention. With `full` or `feedback-only`, records are handed to the backend's non-blocking enqueue and the SDK owns batching, retry, and loss policy, so the sentence claims nothing about what reached a collector; `disabled` claims nothing about future reconfiguration. The disclosure adds no event and never enters the model surface.

## What this plugin does and does not do

`recordFeedback(session, text)` is the command-independent write path. It rejects empty normalized text and appends `feedback/record { text }`; a different UI, hook, or host integration can call it without constructing a slash command. The `/feedback` handler uses that producer and starts no model work. The optional [`dsh-session-telemetry-otel`](../../session/session-telemetry-otel) consumer observes the event without changing its capture contract.

The feedback text appears in exactly one durable payload: `feedback/record`. [`dsh-commands`](../../interaction/commands/README.md) still appends its generic `command/run` / `command/done` pairing, but this definition sets `recordInput: false`, so `command/run` omits `args`; the paired `command/done` carries only the outcome. All three events are log-only and absent from the ordered surface, `deriveMessages()`, and model requests. These appends start persistence's ordinary eager drain, but neither producer forces `session/flush`, so acknowledgement means the feedback is in the log, not that it has reached disk. The acknowledgement identifies both the receiving session and the [shared anonymous user](../../identity/anonymous-user-id/); the first accepted feedback for a harness home can create `$DSH_HOME/.anonymous-user-id`. Rejected empty input leaves only the command pairing settled as `kind: 'error'`, with no `feedback/record` and no user-id lookup.

The event is authoritative rather than the command record because feedback may arrive through a trigger other than `/feedback`. Keeping the payload out of `command/run` avoids two records carrying the same text.

## Composition

The producer injects only `commands`. A custom app mounts the registry plus this plugin:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: command-feedback
  name: '@deepseek-ai/dsh-command-feedback'
```

The shipped `dsh` base mounts this command unconditionally; it has no configuration and no dependency on the persisted-goal stack. The Web client exposes it through the command adapter. Headless mode, ACP automation, and JSON-RPC do not provide a command adapter, so they do not expose it.

## Model Experience

### Human `/feedback` capture

#### What the model sees

Nothing. The slash input, `feedback/record`, and the acknowledgement are absent from model requests. The feedback event and registry lifecycle records are log-only and carry no `surfaceOp`, so they never reach the ordered surface, `deriveMessages()`, or a system prompt. Recording feedback during a turn does not change that turn's remaining requests.

#### Token effect

Zero direct token effect. Neither an accepted entry nor a usage error adds model tokens, in the recording turn or any later one.

#### KV Cache effect

Independent of the model request path. Recording appends to the session log only, leaving an already-reusable request prefix untouched. Nothing this package contributes can invalidate cache reuse.

## Known Limitations and Deferred Work

- **No feedback retrieval or management surface** — the optional OTel plugin uses the event only as a sharing trigger. There is no retrieval, aggregation, categorization, or model-facing tool for `feedback/record`.
- **No structured fields** — an entry is one free-text string with no category, severity, or referenced-event link, so feedback cannot be filtered by subject without re-reading its text.
- **No amend or withdraw** — the session log is append-only and this package adds no tombstone, so a mistaken entry stays recorded and can only be superseded by a later one.
- **No explicit durability barrier** — the acknowledgement follows the append, not a flush, so an entry recorded immediately before a crash can be lost with any other unflushed tail. Feedback is not worth forcing a synchronous disk write for; a consumer that needs one awaits `ctx.sessions.flush(session)`.
- **No visible acknowledgement on a fresh session** — the web transcript renders command rows only once a session is active, so `/feedback` on a still-blank session records the event but shows no acknowledgement row. Recording feedback after the first message renders normally.
- **Web only among the shipped entry points** — headless mode, ACP automation, and JSON-RPC do not provide a command adapter, so `/feedback` is unavailable there.
