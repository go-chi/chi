# Agent Note: Load sessions persisted before message identity

Status: implemented

English | [中文](2026-07-28-load-pre-identity-session-messages.zh.md)

## Problem

The identified immutable message change replaced four durable event payloads with complete message values. Existing v0 JSONL and SQLite sessions still held the immediately preceding shapes: direct `content`/`source` on user and steering events, `content`/`provenance` on assistant events, and `callId`/`content`/`isError` on tool results. Their headers still matched `SESSION_FORMAT_VERSION`, but current-shape validation rejected them before resume could construct a live `Session`.

Changing the message representation without a version bump made those logs indistinguishable at the header level from current v0 logs. The runtime needs a narrow import rule that restores data created by the supported first-party backends without weakening validation for unrelated obsolete or malformed events.

## Decision

`PersistenceCoordinator` normalizes the four exact pre-identity message payloads after backend decoding and before current message validation. It wraps their existing semantic fields in the current role-specific message shape and assigns `legacy-message:<session-id>:<event-seq>` as the deterministic imported `MessageId`. A legacy `tool/result` content replacement inherits the imported id of its replacement target, preserving the current content-only rewrite invariant.

The same normalization runs for `load`, `inspect`, an ownerless loaded state claiming its live session, and HMR prefix adoption. Prefix comparisons therefore compare the live current-shape seed with the same normalized stored view. Current-looking wrappers with missing or invalid fields are not repaired, and unsupported event vocabulary, request headers, versions, and surface relations retain their existing rejection paths.

The upgrade is read-only. Stored legacy records remain unchanged; a resumed session appends only current-shape events after them. Deterministic identities make repeated loads and a mixed legacy/current log reproduce the same message ids without a backend-specific rewrite transaction.

## Alternatives considered

**Reject the logs under the pre-release compatibility stance.** This is the default for unrelated v0 churn, but it strands real first-party sessions even though every old field maps unambiguously to the current message representation.

**Rewrite the complete stored log in place.** This would canonicalize the artifact but violate the append-only storage contract, require separate atomic replacement mechanisms for JSONL and SQLite, and expand a read compatibility fix into a migration system.

**Mint random ids on each load.** The messages would satisfy the type shape but lose stable identity across inspect, resume, restart, and mixed legacy/current appends.

## Consequences

Pre-identity JSONL and SQLite sessions resume with their original message content, sources, assistant provider/model fields, tool correlation, errors, metadata, and surface replacements. The returned events are otherwise indistinguishable from current imported message snapshots and remain deeply frozen.

This is one explicit same-version import exception, not a general v0 compatibility layer. Adding another exception requires another complete, unambiguous mapping at the persistence boundary; malformed current data continues to fail rather than being guessed into validity. The shared coordinator contract exercises the upgrade against the in-memory reference, JSONL, and SQLite backends, including deterministic reload and tool-result replacement identity.

## Related

- [Create every message as an identified immutable value](../architecture/2026-07-28-identified-immutable-message-values.md) — owns the current message identity and immutability contract.
- [Session persistence as an abstract service](../architecture/2026-06-14-session-persistence.md) — owns the append-only backend and resume boundary.
