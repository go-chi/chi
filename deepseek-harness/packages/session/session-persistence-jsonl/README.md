# @deepseek-ai/dsh-session-persistence-jsonl

English | [中文](README.zh.md)

The JSONL durable session-persistence backend — a concrete `SessionPersistence` (the `dsh-session-persistence` seam). Each session has one append-only logical JSONL log, stored as `.jsonl.zstd` by default or raw `.jsonl` when compression is disabled.

## On-disk layout

```
<root>/
  --<normalized-cwd>--/          # readable project directory (or _no-cwd/)
    <encoded-id>/                # session-owned directory
      session.jsonl.zstd         # default: checksummed header frame + append frames
      session.jsonl              # only with compression: 'none'
```

- The first logical line is the immutable `SessionHeader` tagged `{ type: 'session', version, id, cwd?, createdAt, parentSession?, seedLength?, origin?, delegationDepth, agentPreset? }`. `delegationDepth` is required on disk and is `0` for a top-level session; a missing or invalid value rejects the log. `agentPreset` is durable because it decides the resumed session's tools and prompt — restoring a different composition would replay history the model can no longer act on. Every subsequent logical line is one storage record; `assistant/chunk` events are never dropped, and `seq` stays contiguous across the decoded log (`events[i].seq === i`).
- A storage record is a `SessionEvent` JSON verbatim, or — for an eligible run when `packChunks` is enabled — a **packed chunk row** (`text-chunks` / `reasoning-chunks` / `tool-call-chunks`; bare slash-less tags like the header's `session`, so row tags cannot be confused with event types): one line holding a run of ≥3 consecutive same-block `assistant/chunk` delta events, `seq0`/`time0` plus per-member `dt` gaps reconstructing every member's `seq`/`time` exactly. The lossless codec lives in `@deepseek-ai/dsh-session` (`packChunkRuns`/`decodeStorageRecord`) and whitelists exact shapes — anything unrecognized stores verbatim. Reading is layout-blind: `load` always decodes rows, so packed, unpacked, and mixed files load identically.
- The project directory keeps the normalized cwd readable for navigation and is bounded for filesystem component limits. Separator replacement and truncation are intentionally lossy, so cwd strings that normalize alike share a project directory; session ids still select distinct session directories. On a case-insensitive filesystem, identity validation accepts an alternate path spelling only when filesystem canonicalization resolves both spellings to the same transcript. The configured root remains deployment-controlled: it may be project-local, shared, temporary, or centralized. The [project-session directory decision](../../../.agents/notes/implemented/architecture/2026-07-24-project-session-directories.md) records this tradeoff.
- Session ids are unvalidated branded strings, so they are injectively escaped to a single safe path segment before use (no traversal, no collision). The resulting directory is reserved for additional session-owned artifacts; discovery reads only the fixed transcript filename.

## Config

| Key | Type | Notes |
|---|---|---|
| `root` | `string` (required) | Root directory for all session files. **No default** — a `process.cwd()` default would scatter files as the process's cwd changes (bash calls, subprocesses). An existing root must be a readable directory; an absent root is created on first materialization. |
| `packChunks` | `boolean` (default `true`) | Write eligible delta-chunk runs as packed rows (~60% smaller logical logs measured on a real coding session). Set `false` for one-event-per-line diagnostics; reading packed rows works regardless of this write-side switch. |
| `compression` | `'zstd' \| 'none'` | Defaults to `'zstd'`; `'none'` retains newline-delimited UTF-8 text. |
| `preparedSessionCacheSize` | positive integer (default `5`) | Maximum unpublished Sessions retained after cold history inspection for reuse by resume. |
| `writeBatchMaxDelayMs` | positive integer (default `200`) | Fixed coalescing window after an idle live-event queue receives work. Later events do not reset it; flush and teardown bypass it. It does not bound event-loop, serialized-operation, or backend latency. At most Node's `2_147_483_647` ms timer limit. |

`locate(meta)` returns `{ kind: 'jsonl', path }` for the fixed transcript inside the resolved project/session directories. It performs no filesystem I/O: the target can be returned before the directory or file exists, and an existing file contains only the last flushed prefix.

## Physical encoding

The default artifact is a standard concatenation of independent [Zstandard frames](../../../.agents/notes/implemented/architecture/2026-07-19-zstandard-jsonl-session-logs.md): one checksummed frame containing only the header line, followed by one checksummed frame per durable append batch. The backend uses Node's built-in Zstandard API with its default compression level and exposes no level knob. Listing reads and validates only the header frame. `compression: 'none'` keeps the same logical lines in the original raw representation.

A root belongs to one encoding. Startup discovery and targeted lookup reject the opposite suffix with an error naming the incompatible artifact and instructing the caller to select the matching mode or a separate root. Flat `<project>/<id>.jsonl*` artifacts are also rejected instead of ignored. There is no migration, mixed-root fallback, or dual write.

## Durability and crash semantics

- **Bound storage identity.** Lookup requires one matching session directory across the readable project directories, then verifies that the header id equals the requested id and that the header's id/cwd derive the selected transcript path. Listing applies the same path check and rejects duplicate ids. Identity failures occur before repair or append.
- **Lazy materialization.** `create(meta)` writes nothing; on the first `append`, the backend writes and `fsync`s the encoded header and first batch in a temporary file. POSIX publishes it without overwrite via a hard link and `fsync`s the parent directory. Windows publishes it without overwrite via `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)` and creates missing directories through the same write-through pattern. A created-but-never-appended session leaves nothing on disk and is absent from `list`.
- **Append-only.** Flushed events are never rewritten. Subsequent raw batches append lines; compressed batches append one frame. Both paths `fsync`, and a caught write or sync failure rolls the file back to its prior byte length.
- **Crash recovery — preserve valid tail work.** `load` validates every complete compressed frame and scans their decompressed JSONL. If the last frame is structurally incomplete, the reader keeps its complete decoded records, truncates from that frame's start, and re-encodes those records with the synthetic tool, step, and turn closers required by the shared [persistence contract](../../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md). Raw mode truncates from its first incomplete line. An existing compressed artifact with no complete header frame, a checksum/decompression failure in a complete frame, or a defect at or before the last committed `turn/end` is corruption and rejects.
- **Non-mutating inspection.** `inspect()` returns an immutable balanced logical view and may synthesize recovery closers in memory, without truncating an incomplete tail or changing the lightweight revision.
- **Contiguous-seq.** `append` rejects a batch whose first `seq` does not continue the stored log, and rejects non-JSON-serializable `event.data` naming the offending event type.
- **Lightweight revisions.** `listSnapshots(signal?)` identifies a log by its device, inode, size, and nanosecond timestamps, avoiding a full-log parse while changing after append, repair, replacement, or store changes. A full-prefix read requires the same identity before and after reading the bytes, and `readStoredRevision()` uses that identity to validate retained preparations without loading the log. Snapshot listing forwards the exact signal through artifact discovery and checks cancellation around every `stat`; because filesystem `stat` is not interruptible, cancellation waits for the active call to settle, then rejects without starting another.

## Write path

The plugin copies frozen session events into one controller per live session. The first pending event starts the configured fixed batching window, and later events join without resetting it. Expiry starts one durable append; events admitted during that write form a separately bounded follow-up batch. `session/flush` cancels the wait and drains current and pending batches. A per-session cursor prevents resumed sessions from re-appending stored events, and live sessions are seeded when the plugin loads. The owning backend instance serializes operations for one session; disposal drains every retained controller before teardown. Every logical event remains present: batching only lets one compressed frame or raw fsync carry more records.

## Model Experience

### Resumed conversation history

#### What the model sees

JSONL storage contributes no live prompt or schema. Loading restores stored surface history and preserves prior request headers for reconstruction; the new loop composes its current envelope. Recovery balances an assistant request without a durable call with `TOOL_NOT_STARTED`; a durable call without a result becomes `TOOL_OUTCOME_UNKNOWN`, which tells the model to retry only read-only or idempotent work and to verify possible side effects or ask the user. Raw `assistant/chunk` records do not duplicate messages.

#### Token effect

Zero live-request tokens. A resumed agent pays for retained history and its current envelope, plus the quoted repair result for each interrupted call.

#### KV Cache effect

JSONL storage does not mutate live request prefixes. A resumed loop can reuse provider cache only when its reconstructed history, current envelope, and model route match; crash-repair results append.

## Known Limitations and Deferred Work

- **Only the configured encoding and current `SESSION_FORMAT_VERSION` (v0) load** — changing compression requires a separate/fresh root or selecting the legacy raw mode; the pre-release format has no migration.
- **The flat-file storage layout does not load** — use a separate root or move pre-release artifacts into the project/session directory layout before loading.
- **Compressed files are not directly line-readable** — use the backend to load them, or select `compression: 'none'` before writing a fresh root when external line readers are required.
- **Nothing deletes session files** — logs accumulate under `root` until removed externally (the seam has no deletion API).
- **One live writer per session** — append and repair are coordinated only inside the owning backend instance. Another backend instance or process must not write the same session until that owner reaches quiescent disposal; initial same-id publication remains collision-safe through the POSIX no-overwrite hard link or Windows write-through rename without replacement.
- **POSIX materialization requires hard-link support** — first append uses `link()` so same-id races fail instead of overwriting a committed log; Windows uses write-through rename without replacement.
