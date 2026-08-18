# Agent Note: Bound cold blank-session verification

Status: implemented

English | [中文](2026-08-13-bounded-cold-blank-verification.zh.md)

## Problem

The Web session tree hides blank Sessions and reuses the selected blank entry as New Session. Attached Sessions can derive blankness from their in-memory event log, but `session.list` normally avoids loading every cold log. Treating every materialized cold Session as non-blank exposes empty Sessions left by older versions. Treating a projection-cache `blank: true` as current can instead hide a real conversation after the log advances and the fail-soft cache remains stale.

The same cold list used the JSONL artifact mtime for `updatedAt`. Opening a Session appends `session/end-seed`, so a pickup with no human prompt refreshed mtime and promoted that Session above recently used conversations.

## Decision

`dsh-host-apiproxy` registers `sessionListMetadata`, a projection containing `blank` and `lastPromptAt`. The attached summary folds the same functions directly over the live log. `blank` changes only from true to false on `turn/start`; `lastPromptAt` changes only on a `user/message` whose source kind is `user`.

A cold summary trusts cached `blank: false`, because a checkpoint prefix containing `turn/start` remains non-blank. Cached `blank: true` and a cache miss do not prove the current log is blank. When persistence exposes a physical artifact through `locate()` and its observed size is at most the `coldBlankProbeMaxBytes` eligibility threshold (default 1 KiB per Session), the gateway calls `readFrom(id, 0)` and folds exact list metadata from the stored prefix. Files above the threshold, backends without a location, vanished artifacts, and failed reads all produce `blank: false`, keeping the Session visible.

`updatedAt` is the later of `createdAt` and `lastPromptAt`. An eligible artifact read supplies exact `lastPromptAt` at no additional I/O cost; other cache misses or stale checkpoints order the Session too old rather than promoting it from an unrelated file write. After each asynchronous cold read, the gateway checks the live store again and replaces the cold result with an attached summary when another request resumed that Session meanwhile.

## Alternatives considered

**Trust cached `blank: true`.** Rejected because the projection cache deliberately permits a persisted log to advance beyond its checkpoint. A crash or fail-soft write failure after the first `turn/start` would hide a real conversation and could make the client reuse it as New Session.

**Read every cold log.** Rejected because list latency and I/O would scale with total stored conversation bytes. The physical-size eligibility check targets small historical artifacts that can be checked cheaply and degrades larger unknowns toward visibility. It intentionally does not add a persistence operation solely to make the threshold atomic with the read: concurrent growth may increase one probe's read cost, but the additional events can only preserve visibility or change a blank result to non-blank.

**Store blankness and recency in an authoritative persistence index.** Deferred because JSONL has an immutable first line and would require a second durable artifact with ordered updates, while SQLite would require a schema field. The broader exact-index design remains in the [last-activity proposal](../../proposed/architecture/2026-07-29-durable-last-activity-index.md).

**Continue ordering JSONL by mtime.** Rejected because mtime records every artifact write, including pickup boundaries, rather than the latest human prompt. Its error direction promotes untouched Sessions to the front.

## Consequences

Existing small blank JSONL artifacts are hidden without depending on projection-cache availability, and a stale cache cannot hide a stored `turn/start`. A cold list may read each artifact whose observed physical size is within the configured threshold when its cache does not already prove non-blank. The default threshold compares compressed bytes for the shipped Zstandard JSONL backend.

Blank artifacts above the threshold and blank Sessions on location-less backends remain visible. Missing or delayed recency cache entries for artifacts that are not read fall back to `createdAt`. These are conservative degradations: the UI may show an extra empty row or order a Session too low, but it does not hide a conversation or promote one because it was merely opened.

The gateway-owned projection is an effect of the gateway fiber; unloading the gateway removes the key. Unit coverage pins exact-threshold eligibility, stale-true rejection, monotonic false reuse, exact small-log recency, live-attachment races, fallback direction, human-prompt recency, and fiber disposal. A keyless Web snapshot boots the shipped compressed JSONL composition, seeds a small cold blank artifact without a cache row, and verifies that the sidebar omits it.
