# @deepseek-ai/dsh-message-feedback

English | [中文](README.zh.md)

Host-owned editable feedback for one finalized assistant message. The package registers `ctx.messageFeedback`, persists one lifecycle-bound sidecar row per Session in storage-domain, and publishes the Host `messageFeedback.list`, `messageFeedback.put`, and `messageFeedback.delete` unary Remote contract. It is separate from the immutable Session-level `feedback/record` event and performs no telemetry handoff. The [message-feedback sidecar Agent Note](../../../.agents/notes/implemented/architecture/2026-08-10-message-feedback-sidecar.md) owns the design boundary.

Public request, value, version, and failure types are exported from the package root and `@deepseek-ai/dsh-message-feedback/types`; [`src/types.ts`](src/types.ts) is their source.

## Configuration

| key | meaning |
|---|---|
| `maxNoteBytes` | Required positive safe integer: maximum UTF-8 byte length of one optional note. |

Notes must contain at least one non-whitespace character, but accepted text is stored verbatim rather than trimmed. Omitting `note` means the desired value has no note, so a version-matched material `put` clears an existing note. Note validation precedes Session lookup and can therefore return `note-blank` or `note-too-large` for a missing Session without touching persistence.

```yaml
- id: message-feedback
  name: '@deepseek-ai/dsh-message-feedback'
  config:
    maxNoteBytes: 8192
```

The service injects `storageDomain`, `sessionPersistence`, and `sessions`. Its durable domain is `message_feedback`, with one `sessions` table row per `SessionId`.

## Data, lifecycle, and durability

`MessageFeedbackItem` contains `messageId`, `rating: 'positive' | 'negative'`, optional `note`, an opaque equality-only `version`, and Host-assigned `createdAt`/`updatedAt` Unix-millisecond timestamps. A material update preserves `createdAt`, replaces `version`, and keeps `updatedAt` from moving backward. `list` returns fresh immutable snapshots in first-creation order; updating an item retains its place, while deleting and later recreating it appends a new item.

Each stored row carries the inspected Session header identity `{createdAt, cwd}`. A mismatch is treated as absence: `list` returns an empty `items` array, `delete` returns the absent postcondition, and `put` may replace the stale row with one bound to the current identity. This fences a reused `SessionId` when its header identity differs. Forks use a distinct Session identity and receive no feedback-row copy.

`SessionPersistence.inspect()` supplies a cold-safe observation without publishing or resuming an Agent and without committing cold repair. For a Session without a live owner, `listSnapshots()` first decides definite absence; an `inspect()` failure for a catalogued Session remains an infrastructure failure rather than being guessed into `session-not-found`. `put` accepts only a non-empty, append-origin `assistant/message` with the requested `MessageId`; replacement-origin messages, empty usage-only assistant records, and non-assistant records return `target-not-found`.

After initial validation, `put` establishes a durability barrier before writing the sidecar. A matching live Session commits through the canonical `ctx.sessions.flush` checkpoint, then both live and cold paths are physically read from sequence zero through `SessionPersistence.readFrom`. The resulting observation's header identity and target are validated again. A missing flush participant, changed identity, vanished target, or physical-read failure prevents the sidecar commit, so durable feedback never precedes the durable target message.

Message feedback is not Session-log content or a Session projection. It emits no `feedback/record` event, does not enter model history, and does not trigger `FEEDBACK_ONLY` telemetry release.

## Service and Host Remote contract

The same three `MessageFeedbackService` methods are published by `TypertRemoteService` and `@Remote`; the Host endpoint names are `messageFeedback.list`, `messageFeedback.put`, and `messageFeedback.delete`. Every method returns a discriminated business union: `{ ok: true, value }` or `{ ok: false, error }`. Operational storage, corruption, or missing-durability-listener failures reject instead of being mislabeled as business errors.

| Method | Request | Success `value` | Rejected `error.code` |
|---|---|---|---|
| `list` | `MessageFeedbackListRequest { sessionId }` | `MessageFeedbackListValue { items }` | `session-not-found` |
| `put` | `MessageFeedbackPutRequest { sessionId, messageId, rating, note?, ifVersion }` | committed `MessageFeedbackItem` | `session-not-found`, `target-not-found`, `version-conflict`, `note-blank`, `note-too-large` |
| `delete` | `MessageFeedbackDeleteRequest { sessionId, messageId, ifVersion }` | `MessageFeedbackDeleteValue { absent: true }` | `session-not-found`, `version-conflict` |

`MessageFeedbackVersionConflict` returns the authoritative `current` item, or `null` when no item exists. This lets a caller reconcile the current rating, note, and version without a second `list` request. `MessageFeedbackNoteTooLarge` returns both `maxBytes` and `actualBytes`. The Client Remote aggregate does not mount the generated client contribution yet; Host callers can use the service/Remote contract without that client assembly.

## Compare-and-set and idempotency

`ifVersion: null` requests creation only; every request for an existing item requires its exact current version, including a no-op whose desired value already matches. The check is per message rather than per Session, so changing one item does not conflict with another. Every material create or update assigns a fresh opaque UUID token, preventing stale writes from crossing an ABA value cycle.

A matching-version no-op returns the already stored item with unchanged version and timestamps. After a lost success response, a retry with the old token receives `version-conflict.current`; the caller can compare that authoritative item with its desired value without an extra read. `delete` ignores `ifVersion` when the item is already absent and always returns the stable `{ absent: true }` postcondition after success.

A per-Session promise queue encloses inspection, durability validation, sidecar read, comparison, and whole-row write. These semantics serialize concurrent mutations through one service instance; storage-domain itself has no cross-process conditional write.

Plugin disposal closes mutation admission, drains every operation already accepted into the per-Session queues, and only then closes the storage domain. A mutation submitted after disposal begins rejects as a lifecycle failure instead of entering a closing domain.

## Model Experience

### Local message-feedback state

#### What the model sees

Nothing. `ctx.messageFeedback` registers no tool, prompt section, model-facing context, or Session event; feedback stays in a Host-owned sidecar unless a separately documented Consumer explicitly exposes it.

#### Token effect

Zero. No request, result, rating, note, timestamp, or failure from this package enters a model request.

#### KV Cache effect

Independent. Listing or mutating message feedback does not touch a model request prefix and cannot invalidate an otherwise reusable provider cache entry.

## Known Limitations and Deferred Work

- **Client aggregate and UI are absent** — the Host Remote contract ships, but the Client Remote aggregate contribution and any UI consumer are separately owned and deferred.
- **Compare-and-set is single-process** — the per-Session queue serializes one service instance only; multiple Host processes writing one storage root can still lose updates because storage-domain exposes no cross-process conditional write.
- **No durable Session deletion cascade** — Session persistence has no deletion API, and `session/disposed`/`host/session-removed` mean detach rather than durable deletion. The service therefore retains empty rows and may leave orphan rows after out-of-band log removal instead of deleting valid feedback on detach.
- **Detach/catalog retirement window** — a request in the narrow interval after live detach but before the persistence catalog materializes the header can receive `session-not-found`; callers retry after retirement materialization.
- **Header identity is not a content fingerprint** — `{createdAt, cwd}` detects reuse only when those fields differ; a cloned log retaining the same header identity is indistinguishable.
- **Trusted caller boundary** — `list`/`put`/`delete` carry no authenticated actor or audit identity. A deployment must expose the Host gateway only through its trusted or separately authenticated boundary until authorization and attribution are added.
- **Catalog and row bounds** — a cold request scans the complete Session snapshot catalog because persistence has no lookup-by-id metadata operation. `maxNoteBytes` bounds one note, but the item count and aggregate retained bytes of one Session row are not capped; an indexed metadata read and deployment-owned row bound remain deferred until a concrete consumer defines their policy.
