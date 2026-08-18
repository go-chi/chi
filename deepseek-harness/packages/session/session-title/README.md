# @deepseek-ai/dsh-session-title

English | [中文](README.zh.md)

Log-backed session titles with an immediate deterministic fallback and one optional asynchronous provider. Every accepted revision is a log-only `session/title` event; `foldSessionTitle()` and `ctx.sessionTitle.get()` select the latest event and return its event seq and timestamp.

Only text blocks from human `user/message` events are eligible. The first eligible prompt schedules a fallback from its first words within the configured UTF-8 byte limit. Whitespace is normalized, terminal control sequences are removed, and truncation never splits a code point. Empty and non-text prompts wait for later eligible input.

## Service: `SessionTitleService` (ctx key: `sessionTitle`)

- `get(session)` folds the latest accepted title from a live or replayed log.
- `refresh(session, signal?)` materializes the fallback when needed, then explicitly runs the registered provider over the current eligible messages. Provider errors and caller cancellation reject; cancellation does not roll back an already accepted fallback event.
- `rename(session, title)` accepts an explicit user title synchronously: it normalizes the text, supersedes in-flight automatic work, and appends a `session/title` event with the `user` source. A user-sourced latest title pins the session — later user messages schedule no automatic revision; an explicit `refresh` remains the deliberate unpin.
- `register(provider)` installs the sole optional provider and returns its awaitable Cordis effect disposer. A second registration throws immediately; disposal aborts pending and active calls, waits for their settlement, and only then permits another provider to register.

Automatic work never delays the main agent response. A provider starts only after a marked loop-built request's exact route matches the current logged `request/header`, including when the unchanged header needs no new snapshot. Its late completion appends a standalone log-only event directly through `Session` without opening a turn. Persistence observes that event eagerly and drains on ordinary lifecycle checkpoints; title publication itself does not force a flush. Automatic failures warn and retain the latest title. New all-message revisions, provider disposal, session disposal, and explicit refresh abort older work, and a stale completion cannot append. Concurrent explicit refreshes reserve their revision before provider work, while overlapping automatic and explicit fallback requests share one session-local in-flight append. The service and bundled model provider each append their own literal event type, so no generic title-write marker, cast, or settlement queue is needed. Service teardown cancels queued work and drains calls that ignore cancellation before unloading completes.

Forks inherit title events in their seed unchanged. The first-prompt cadence does not automatically retitle a child; the all-messages cadence may append a new revision after the child receives a later human prompt.

## Configuration

All limits are required; the library supplies no defaults.

| Key | Contract |
|---|---|
| `fallbackMaxWords` | Positive maximum whitespace-delimited words in the deterministic fallback. |
| `fallbackMaxBytes` | Positive maximum UTF-8 bytes in the fallback; must not exceed `maxTitleBytes`. |
| `maxTitleBytes` | Positive maximum UTF-8 bytes accepted from any source. |

## Provider contract

A provider supplies a branded stable id, automatic mode (`first-prompt` or `all-prompts`), and `generate(request)`. The request carries the live session, all eligible messages through one fixed revision, the current logged main-request route when available, and cancellation. The result identifies a non-empty title, unique ordered source-message seqs from that request, and the optional provider/model route used to generate it. The service normalizes and validates the result before it becomes durable.

See the [session-title data structures](../../../docs/subsystems/session-title.md) and [implemented decision](../../../.agents/notes/implemented/feature/2026-07-21-log-backed-session-titles.md).

## Model Experience

### Session title state

#### What the model sees

Nothing. `session/title` is log-only and never enters the session surface, `deriveMessages()`, system prompt, tool schemas, or request prefix.

#### Token effect

The fallback and accepted provider revisions add zero tokens to the main agent request. An optional provider's separate auxiliary request is documented by that provider package.

#### KV Cache effect

None for the main request; title events do not change its reconstructed content or cache key.

## Known Limitations and Deferred Work

- Title deletion (unpinning back to automatic titles without an explicit `refresh`), search, and list indexing are outside this service.
- The provider registry deliberately accepts at most one implementation, so a deployment cannot compose competing title strategies without writing one provider that owns their precedence.
