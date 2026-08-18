# Agent Note: Session log versioning — one integer, an upgrade chain, and a per-event ignorable marker

Status: implemented

English | [中文](2026-08-10-session-log-version-mechanism.zh.md)

## Problem

Session logs must be upgradable after release, and the runtime that ships first is the floor for every later decision: whatever refusal and degradation behavior is missing from the first released reader can never be added to the copies users already run. Release issue #1901 required at minimum that an old runtime reading a newer session format reports "unsupported" instead of misreading it. The pre-change reader did the opposite on both axes: `assertVersion` rejected any version mismatch with one direction-blind message, and the JSONL decoder passed unknown event types through untouched, so reconstruction silently skipped them — resuming a gutted session with no diagnostic at all.

## Decision

**One monotonic integer, no major/minor split.** Whether a version step is auto-upgradable is a property of that step — expressed by whether its upgrader exists — not something a two-level numbering scheme should promise in advance (you rarely know at design time whether the next change will turn out "major"). This matches the SQLite backend's `SCHEMA_VERSION` precedent.

**The writer decides bumps, not the reader.** A bump is required exactly when an old runtime could no longer handle a new log with full semantic correctness. "Parses without error" is not the bar: silently skipping content that shapes reconstruction is a wrong read. Only structural changes qualify — header shape, event envelope, core event semantics, the surface mechanism (`SurfaceEventType` set, `SurfaceOp` variants). When unsure, bump: a near-identity upgrader is almost free, a missed bump silently corrupts old readers.

**Read rules by direction.** Equal version: read normally. Newer than the reader: refuse, name the direction ("written by a newer harness — upgrade"), and point at the raw log artifact so the user can still see the text (`SessionFormatUnsupportedError`, distinct from `SessionPersistenceCorruptionError` because nothing is damaged). Older than the reader: convert in memory through the chain of n→n+1 upgraders for viewing; persist the converted log only when the session is actually continued (atomic temp-file replace, original kept as backup). A step whose upgrader cannot be written is left empty, which cuts off every version at or below it — those degrade to raw-text viewing.

**A per-event `ignorable` marker covers vocabulary growth, so ordinary event additions never bump the version.** The event vocabulary is decided by which plugins are mounted, which a single version integer cannot describe. A reader meeting an unrecognized event type refuses to interpret the log unless the event carries `ignorable: true` in its envelope. The default is *required*: forgetting the marker over-refuses a resumable session (an inconvenience), while a default of ignorable would make the same mistake silently resume a gutted one (a safety failure). The architecture makes this sound: model-visible content flows only through the three `surfaceOp`-marked surface event types plus the `request/header`/`request/context` folds, so the dangerous unknowns are exactly the non-surface events that change how the rest of the log is read (`session/end-seed` is the existing example).

## Consequences

What shipped in v0 (release 0812): direction-aware refusal with the raw-log path; the unknown-event guard against a generated known-vocabulary list (`KNOWN_SESSION_EVENT_TYPES`, emitted by `gen-persistence-catalog` from every `SessionEventMap` merge and kept fresh by `verify-persistence-catalog`); the `ignorable` envelope field accepted by seed validation, both backends (a dedicated SQLite column, `SCHEMA_VERSION` 15), and the BFF wire schema. The upgrader chain itself is deferred until the first real v0→v1 step exists to test it against; writers do not yet set `ignorable` (no producer needs it), so `Session.append` gains that surface with its first user. Until a registration surface exists, an out-of-repo plugin's events refuse resume under first-party readers — the pre-release stance accepts that, and the refusal is loud rather than silent. The unknown-type guard is read-side only: `appendCore` keeps rejecting retired legacy shapes but does not vocabulary-check new types, because an append-time refusal would stall a live session's durability mid-flight, which costs more than a loud refusal at the log's next load. The JSONL backend additionally refuses a foreign version from the raw header line before validating today's header shape or decoding any event row, so a structurally different future format still reports the upgrade direction instead of "corrupt"; SQLite gates whole-file structure through its own `SCHEMA_VERSION` pragma first.

## Alternatives considered

- **Major/minor versioning** — the "is it convertible" bit lives on each step's upgrader, and pre-committing it into a number shape invites wrong promises.
- **Default-ignorable unknown events** — inverts the failure mode of a forgotten marker from visible over-refusal into silent corruption.
- **Auto-migrating on view** — rewriting the artifact on open turns a read into a destructive write: a converter bug corrupts logs at browse time, and a same-directory older runtime loses access because a newer one merely looked.
- **Per-plugin runtime registration of known event types** — would make the known set composition-dependent, so a leaner same-version composition would refuse logs a fuller one wrote. The generated repo-wide list keeps same-version reads uniform; out-of-repo plugin events are outside it by construction, and a registration surface for them is deferred until such a consumer exists.
