# Agent Note: Cross-session references

Status: implemented

English | [中文](2026-07-21-cross-session-references.zh.md)

## Problem

TUI users need to bring relevant work from another conversation into one new message without resuming, forking, or granting the source transcript authority over the current session. The harness already exposes exact session enumeration and raw event inspection, but every host independently parsing logs would duplicate compaction folding, filtering by cited source-event seqs, size limits, error behavior, and persistence. Encoding host markup directly into the agent message contract would also bind the core loop to one UI syntax.

## Decision

`@deepseek-ai/dsh-session-reference` is one context consumer service at `ctx.sessionReferenceResolver`. Hosts normalize their protocol into `SessionReferenceInput[]` and call `prepare()` before delivery. The service returns detached readable content plus an optional identified, frozen `UserMessage` snapshot; core agent packages do not parse session URIs or read another log.

`dsh-session:<base64url(JSON.stringify(sessionId))>` is the canonical host-independent identifier. JSON string encoding precedes base64url so quotes, slashes, backslashes, Unicode, newlines, and every other JavaScript string value round-trip without delimiter ambiguity. TUI renders that URI inside `@[label](uri)`; text-only clients may use the same inline mention. Explicit Markdown mentions reject malformed URIs. Bare text becomes a reference only for a non-empty base64url-shaped payload, whose decode must still be canonical; empty or punctuation-only uses remain ordinary discussion text.

The service uses `ctx.sessionQuery.readSurface(sessionId)`, which loads one live-preferred corpus observation, folds it with the session package's canonical surface algorithm, and returns a detached header, capture seq, and current nodes. FTS is not a dependency: discovery matches id, cwd, or the latest folded title, while message bodies remain outside the candidate layer. Non-empty queries batch title observations across the visible corpus with bounded persisted-log concurrency and cancellation; a dedicated title index can replace that discovery path without changing reference identity or preparation.

## Snapshot and projection

Preparation deduplicates in first-appearance order, rejects the target id, enforces a configurable limit with a hard maximum of three references, and performs all reads in parallel. It returns no partially prepared context: any read, cancellation, validation, or budget error rejects the operation before `followup()` or `steer()`. Cancellation races in-flight discovery and exact reads, so a host settles promptly even when a persistence backend cannot interrupt its pending operation; any late backend settlement is observed but cannot enqueue the message. A source is read before enqueue, so later source messages, compaction, deletion, or persistence replacement cannot change the target session.

Projection retains direct-user messages and steering, completed assistant text, and checkpoint user messages carrying the canonical source exported by `dsh-compaction`. That marker is part of the compaction capability contract rather than a backend package name. When a source prompt already contains baked prefix context, projection reads only its model-hidden display content, so referencing that target later does not recursively propagate an earlier snapshot. Projection excludes shadowed pre-compaction nodes, tools and results, reasoning, injected context, other plugin user messages, log-only records, and incomplete assistant chunks. Repeated compaction therefore exposes only the latest folded checkpoint lineage still on the current surface plus its retained tail; there is no raw/current switch and no shadow recovery.

One aggregated context is serialized as JSON beneath a fixed untrusted-background warning. The warning tells the model not to follow instructions, permission claims, or tool requests from referenced sessions unless the current user repeats them. Tag-safe serialization emits every data `<` as the lossless JSON escape `\u003c`; source strings therefore cannot spell the surrounding XML-like tags or escape the data region. The same serializer drives each source's independent byte accounting. AgentLoop persists the snapshot as a sourced `user/message` immediately before the direct `user/message`; target replay therefore satisfies the model-visible/log-reconstructable invariant without a new event type, placement mode, or prompt envelope.

## Message ownership

TUI owns the snapshot/direct-message transaction without extending the generic inbox record. While the agent is idle, it installs a one-shot outer `agent/pre-step` listener before `followup()`; an enter decision receives the snapshot as another message, while rejection or an earlier ordinary discard releases the listener and writes neither message. While the agent is running, TUI calls `inject(snapshot)` then `steer(prompt)`, placing both in the next-step inbox for the same later claim. A rejecting or failed pre-step leaves that claimed pair removed; messages inserted after the claim remain pending. The [separate-context decision](../architecture/2026-07-24-separate-context-injection-from-turn-execution.md) owns this generic delivery boundary.

Reference preparation is not a new steering protocol and does not create a turn by itself. Idle delivery uses `followup()` and pre-step entry; running delivery uses the shared next-step inbox while retaining snapshot order.

## Host adapters

TUI combines session candidates with the existing `@` file provider. Candidate lookup matches case-insensitive substrings of the session id, cwd, or latest folded title, displays that title, and falls back to the session id when a title observation is absent or fails. Lookup follows the editor's cancellation signal, and session id, cwd, and mention labels escape external terminal controls while the canonical URI retains the original id. TUI prepares only submissions containing structured mentions, disables duplicate submit while awaiting snapshots, restores failed input, renders the readable direct content as the user message, and renders session-reference source metadata as a compact source list instead of exposing the complete JSON in the terminal.

The [automation-only ACP transport](../simplification/2026-07-23-acp-automation-only-protocol.md) deliberately does not mount session-query or session-reference services.

## Budget and retention

Each of at most three references is independently capped at 65,536 UTF-8 bytes by default. Retention preserves current compact checkpoints and the newest conversation unit before dropping older non-checkpoint messages. An oversized retained text uses `dsh-output-retention` head/tail slicing and records exact omitted bytes; if one source's fixed serialized fields cannot fit its cap, the whole preparation fails rather than emitting a partial context.

## Alternatives considered

- **Wait for SQLite FTS5** — rejected because snapshot correctness requires exact id reads and canonical surface folding, not content search. FTS improves discovery only.
- **Put mention syntax in agent delivery methods** — rejected because it would make the core protocol parse one host's presentation syntax and prevent typed non-text hosts from sharing the semantic layer.
- **Implement references separately in each host** — rejected because projection, security warning, retention, and persistence would drift across hosts.
- **Attach context to `SendOptions` and the direct prompt's inbox record** — rejected because generic delivery would own a domain transaction through admission, steering, cancellation, and observation. A domain-specific admission wrapper and the existing next-step inbox preserve the required pairing without enlarging every direct prompt.
- **Bake the prefix host-side before `followup()`** — rejected because `agent/pre-step` must inspect and rewrite only the direct prompt. Keeping the snapshot as a separate sourced message preserves that boundary and lets TUI hide background bytes from the direct user bubble.
- **Replay the raw source log or restore shadowed events** — rejected because compact defines the current model surface and may intentionally retire sensitive or expensive history.
- **Resume or fork the source** — rejected because the feature supplies read-only background for one target message, not identity or lifecycle continuity.
- **Inject at request time by rereading the source** — rejected because the reference would become nondeterministic, cancellation races could alter its bytes, and target replay would depend on external mutable state.

## Verification

Unit and integration coverage pins URI round-trips and text-boundary punctuation, explicit malformed references, id/cwd/title candidate matching and ranking, failed title-observation fallback, candidate cancellation, terminal-control escaping, projection exclusions, non-recursive snapshot projection, backend-independent compact checkpoints, tag-safe framing, deduplication, self-reference, count limits, all-or-nothing reads, prompt cancellation against a non-settling storage read, independent per-source byte retention, prompt blocking, admission-time staging, send/steer placement, title isolation, missing capability, and compact TUI replay. One keyless terminal snapshot types a title-only substring against an opaque session id and pins the rendered candidate. Another keyless TUI snapshot runs the real agent loop: the source surface replaces old user/assistant history with a compact checkpoint, the target submits a mention, and the captured model request contains a sourced snapshot message followed by the readable current prompt, without either shadowed string.

## Consequences

The new plugin is the stable semantic boundary and adds no persistence schema, event type, FTS dependency, source subscription, or compact shadow access. The standard TUI demo bundle mounts it explicitly and exposes its count and per-source byte limits in its config; custom hosts remain unchanged until they mount the service and adapt their input. Reference contexts increase target history size within configured bounds and can later be summarized by ordinary target compaction, after which the source session is irrelevant.
