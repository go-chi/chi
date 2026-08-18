# Agent Note: Prune dead methods from the persistence seam

Status: implemented
Archived: 2026-07-26

English | [中文](2026-06-20-prune-dead-seam-methods.zh.md)

> **Implementation note:** Only `SessionPersistence.has()` and `.delete()` were removed. `BashExecutor.get()` and `.list()` remain because removing their one-line lookup surface required substantially more completion-tracking machinery in consumers. Their id branding is covered by the [branded-ids Agent Note](../architecture/2026-06-20-branded-ids.md).

## Problem

A capability seam ([interface / implementation / consumer](../architecture/2026-06-13-capability-seams.md)) carries abstract methods that no consumer calls. The seam exists to let implementations and consumers evolve independently — but a method no consumer programs against is not a seam, it is speculative surface every implementation must still implement and test.

### `SessionPersistence.has()` and `.delete()`

The abstract service declared its operations beyond create/append: `load`, `list`, `has`, `delete`. Production consumers use `load()` and `list()` for resume and session discovery, while no production caller uses persistence `has()` or `delete()`. The similarly named in-memory collection calls in protocol and UI code are unrelated. The only callers of persistence `has`/`delete` were the contract suites and per-backend specs.

`has()` was not just unused: it added a tracked-vs-untracked coordinator probe and a contract branch even though `loadStored(id)` already owns durable existence checks. `delete()` dragged the `deleteStored` backend hook that every backend had to implement. This is the [drop-mutable-session-summary](2026-06-19-drop-mutable-session-summary.md) pattern: a contract test exercised both, but no shipping code asks "is this session persisted?" or removes one.

## Decision

The methods nothing consumes are removed — from the abstract seam, the implementation, and the contract/spec suites that existed only to exercise them:

- `SessionPersistence.has()` / `.delete()` are gone: the abstract declarations, the coordinator's `has`/`delete`/`deleteCore`, and the `PersistenceBackend.deleteStored` hook (jsonl + sqlite each implemented `deleteStored` only to satisfy the hook — those implementations went too). The backends are the [dual-backend](../architecture/2026-06-14-session-persistence.md) design and otherwise out of scope; removing a hook they implemented for no consumer is part of removing the hook, not a backend redesign.
- Every doc and source-comment reference is updated to the surviving four-method, `list()`-only contract — not only literal `has(`/`delete(`/`deleteStored` spellings but `{@link has}`/`{@link delete}` JSDoc links and "six public methods" counts — across the seam and backend READMEs, [docs/architecture.md](../../../../docs/architecture.md), the [session-persistence](../architecture/2026-06-14-session-persistence.md) and [write-coordinator](../architecture/2026-06-18-shared-persistence-write-coordinator.md) Agent Notes, and the coordinator/backends JSDoc.

## Alternatives considered

### Why not keep them as "the seam should be complete"?

The instinct that a persistence seam "should" offer delete is real — and it is exactly the speculative-completeness the pre-release stance warns against ([AGENTS.md](../../../../AGENTS.md): optimize for the correct foundation, not for hypothetical callers you do not have). `delete()` is one method to re-add the day a consumer needs it: a session-management UI that deletes old sessions will want it — add it then, designed against that UI's real needs (soft-delete? cascade? confirmation?), not guessed now.

Re-adding a seam method with a live consumer is cheap and better-designed than the speculative version, because the consumer pins the contract. Carrying it unused means every implementation (and every future backend) must implement and test a method that does nothing.

## Verification

`has`/`delete`/`deleteStored` are gone from the persistence seam, impl, and contract suites with no new dead exports; the remaining operations (`create`/`append`/`load`/`list`) are untouched, with persistence-backed session queries and crash recovery behaving identically; and the seam README and `docs/architecture.md` list only the surviving methods.

## Consequences

- **`delete()` is the kind of operation a product eventually wants.** True — but "eventually" is the point. Deleting it now and re-adding it against a real consumer is strictly better than shipping a guessed contract. The dual backends each shed a `deleteStored` impl, which is a bounded edit in otherwise-out-of-scope packages.
- **Low coupling.** The removal is confined to the persistence seam + impl + tests; no cross-package consumer references the removed methods, so there is no ripple beyond the docs.

Modest size, but it converts the seam from "what an implementation must provide for nobody" back to "exactly what a consumer uses."
