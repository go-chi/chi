# Agent Note: Load sessions from the pre-react-loop format

Status: implemented

English | [中文](2026-08-04-load-pre-react-loop-sessions.zh.md)

## Problem

The react-loop simplification changed durable events while retaining `SESSION_FORMAT_VERSION` 0. Stored sessions from the change's base contain `steering/message` and `turn/start.trigger`; their terminal reasons also use coarse `aborted`, separate `disposed`, and two older error payloads. Current surface and turn invariants cannot replay those records directly.

The new durable inbox is not part of this compatibility problem. The base emitted process-local inbox notifications but no `agent/inbox/*` session events, so replaying old history as pending work would resurrect already claimed or discarded prompts.

## Decision

`PersistenceCoordinator` recognizes the exact pre-react-loop shapes after backend decoding and projects them into the current read view. It removes the obsolete `turn/start.trigger`, converts `steering/message` to the same identified `user/message`, maps old failure facts into the current structured error, folds `disposed` into an aborted turn with the `disposed` cause, and represents coarse aborted records with the persistence-only `{ kind: 'legacy' }` cause because their caller is unavailable.

The coordinator applies the projection to `load`, `inspect`, adoption, HMR prefix comparison, and `readFrom`. A seek-capable `readFrom` normally reads only its suffix; when that suffix contains a legacy event needing an earlier replacement identity, the coordinator loads and normalizes the complete prefix before returning the requested seq range.

The importer does not synthesize inbox splices. A resumed pre-react-loop agent begins with empty pending lists, matching the base runtime's inability to persist pending inbox work. The stored artifact remains append-only and later events use the current format.

## Alternatives considered

**Treat the same-version records as unsupported.** This follows the pre-release default but strands sessions produced by the PR base even though the removed steering content and terminal facts have complete mappings.

**Replay old inbox notifications into durable splices.** Those notifications were not session events and do not provide a trustworthy pending-state snapshot. Inferring insertions without every claim and discard would re-run consumed work.

**Assign coarse aborted records to an existing caller.** Mapping them to `user`, `parent`, or `hook` would invent a caller that the old record did not name. A dedicated `legacy` cause keeps the stop classification without making a false audit claim.

**Rewrite stored JSONL and SQLite records.** A rewrite would violate the append-only contract and require backend-specific atomic migration machinery for a read compatibility boundary.

## Consequences

Sessions written in the refactor's base format resume through the current AgentLoop with their steering content, turn boundaries, error facts, and stop classification intact. The shared coordinator contract covers in-memory, JSONL, and SQLite `load`/`inspect`/`readFrom`, including the SQLite suffix fallback; an assembled JSONL Agent resume verifies that the historical transcript is visible while both new inbox lists start empty.

This exception supports the base format, not intermediate formats produced during development of the refactor. In particular, it defines no migration for earlier experimental `agent/inbox/spliced` payloads. Exact-shape recognition keeps malformed current-looking records on their rejection path instead of guessing them into validity.

## Related

- [Load sessions persisted before message identity](2026-07-28-load-pre-identity-session-messages.md) — owns deterministic identities and the general read-only import boundary for another same-version format change.
- [Session persistence as an abstract service](../architecture/2026-06-14-session-persistence.md) — owns append-only backend storage and resume.
