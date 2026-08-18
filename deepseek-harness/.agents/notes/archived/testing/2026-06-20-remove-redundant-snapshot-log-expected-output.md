# Agent Note: Use `session.jsonl` as the only snapshot session-log artifact

Status: implemented
Archived: 2026-07-26

English | [中文](2026-06-20-remove-redundant-snapshot-log-expected-output.zh.md)

## Problem

Model-driving ACP snapshot scenarios ship both `session.jsonl` and `session.expected.jsonl`. For normal recorded scenarios, `session.jsonl` is the replay fixture harvested from a real run, and the replay test normalizes the newly persisted log and compares it to `session.expected.jsonl`. In the current fixtures, the two normalized logs are identical for ordinary recorded scenarios.

Authored override scenarios (`error-finish`, `cancel`) currently use `replay.override.json` to drive model behavior and keep `session.jsonl` as a minimal dummy fixture, while `session.expected.jsonl` holds the expected persisted log. The override file is a JSON array of `ReplayEntry` objects: `{ "kind": "chunks", "chunks": StreamChunk[] }`, `{ "kind": "throw", "chunks": StreamChunk[], "message": string, "code": string }`, or `{ "kind": "hang" }`. That split is also unnecessary: when an override sidecar exists, `llm-replay` replaces the derived script and does not need `session.jsonl` for model chunks, so `session.jsonl` can still be the expected session-log artifact for the scenario.

## Decision

The `session.expected.jsonl` concept is removed entirely. Every scenario has at most one committed session-log artifact, `session.jsonl`:

- For recorded scenarios, `session.jsonl` remains the raw harvested log. Replay still derives model chunks from it, and the snapshot test compares the replay run's normalized persisted log against normalized `session.jsonl`.
- For authored override scenarios, `replay.override.json` drives model behavior and `session.jsonl` holds the expected produced session log. The replay adapter ignores the fixture for model chunks when the override exists, so the same file can be the expected log without affecting replay behavior.
- For no-model scenarios, `session.jsonl` can stay as the minimal fixture needed to boot `llm-replay`; no session-log comparison is needed unless the scenario creates a persisted session.

Stdout expected outputs remain unchanged; they are the editor-facing projection and are not redundant with the session fixture.

## Alternatives considered

**Normalizing both sides against a shared (replay-run) context** — rejected: `normalizeSessionLog` scrubs cwd by exact string match, so the fixture's recorded cwd would survive unscrubbed and every compare would fail. Each side normalizes against its own header-derived context — the implementation note below carries the mechanics.

## Verification

`session.expected.jsonl` appears nowhere in the snapshot harness, fixtures, orphan guards, or docs; the snapshot test derives the expected session log from `session.jsonl` for every model scenario; authored sidecar scenarios commit their expected produced log as `session.jsonl` with `replay.override.json` as the model-behavior override; and the orphan-fixture guards know which files each scenario kind requires. The [ACP snapshot tests Agent Note](2026-06-19-acp-snapshot-tests.md) describes the reduced fixture set.

## Consequences

Reviewers lose one artifact name that made the expected persisted log visually separate from the replay fixture. The stdout expected output still protects the editor transcript, and comparing replay output to `session.jsonl` preserves the loop/persistence regression check without duplicating files.

## Implementation note

Each side is normalized against its own header values because recording and replay have different ids, paths, and timestamps. `fixtureContext()` derives the fixture context from its header, making already-normalized fixtures idempotent. Session logs use plain equality rather than file-snapshot updates, so comparison never rewrites fixtures.
