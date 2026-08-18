# @deepseek-ai/dsh-fs

English | [中文](README.zh.md)

The **`FileSystem`** (`ctx.fs`) defines the storage primitives in one execution world — resolve paths, expose canonical process paths and file URIs, test containment, read whole or streaming text, read bounded raw bytes, inspect/list metadata, write atomically, and apply a literal edit — without saying HOW. Both mutations take their version guard **optionally**, so `ctx.fs` on its own is a complete, unconstrained storage seam. This package also owns the `fs/*` policy event vocabulary the tool dispatches and the policy plugin listens for.

This package owns the Service Definition and provider contract layer of the four-layer filesystem stack, split so each concern can evolve (and be swapped) independently (see [the capability-seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md), [the filesystem capability-seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-17-filesystem-capability-seam.md), [the split-the-filesystem-seam Agent Note](../../../.agents/notes/implemented/simplification/2026-06-26-fsspec-style-fs-seam.md), and [the file-context event-gate Agent Note](../../../.agents/notes/implemented/architecture/2026-06-26-file-context-as-event-gate.md)):

| Layer | Package | Role |
|---|---|---|
| tool / executor | `@deepseek-ai/dsh-tool-fs` | model-facing `read`/`write`/`edit` schemas + read windowing + text rendering; reads/writes/edits via `ctx.fs`, dispatches the `fs/*` events |
| policy | `@deepseek-ai/dsh-fs-observation-policy` | observed-state + read-before-edit + version-guarded write/edit, contributed through the `fs/*` event gate (no service) |
| provider contract | `@deepseek-ai/dsh-fs` (this) | `ctx.fs`: execution-world paths, text IO, and atomic mutation primitives (optional version guard); owns the `fs/*` event vocabulary |
| provider | `@deepseek-ai/dsh-fs-local` | the host-filesystem implementation |

`fs-sandbox` and `fs-e2b` implement this interface without touching the policy/tool layers.

## Service API (`ctx.fs`)

A backend subclasses `FileSystem` and implements twelve primitives.

| Member | Semantics |
|---|---|
| `resolve(path, opts?)` | Resolve a path into a stable `FsTarget` (opaque `targetKey`, `displayPath`). `opts.cwd` is the base a relative `path` resolves against (a caller supplies its session workspace; absolute paths ignore it; omitted ⇒ the backend default), while `opts.signal` aborts a backend round-trip. Async — a remote backend may need I/O. The same file via different paths must yield the same `targetKey`. |
| `processPath(target)` | Return the canonical absolute path that a subprocess in this provider's execution world can open. This is intentionally distinct from opaque `targetKey`. |
| `fileUrl(target)` | Return the canonical `file:` URI in the execution world's platform syntax. The backend, not the host process, owns encoding. |
| `contains(parent, child)` | Test canonical identity/descendant containment without exposing or parsing target keys. Both targets come from this provider. |
| `stat(target, signal?)` | Return `FsInfo` metadata (`version`, `type`, optional `size`), or `undefined` when the target is absent. Never content. |
| `lstat(path, opts?, signal?)` | Return `FsPathInfo` metadata without following the final path component when it is a symlink. This is path-shaped so consumers can reject repository-owned symlinks before `resolve` follows them into a target. |
| `readText(target, signal?)` | Read the whole regular text file as one decoded string. Owns regular-file checks, UTF-8 decoding, binary/NUL rejection (`FS_NOT_TEXT`). |
| `streamText(target, signal?)` | Stream the same text as decoded chunks for large files (cross-chunk UTF-8 decoding stays here); consumers that need a byte ceiling enforce it while consuming the stream. |
| `readBytes(target, signal, maxBytes)` | Read a complete regular file as raw bytes with no decoding or binary rejection. `maxBytes` is required and bounds the complete content at this seam: a known or discovered overflow fails with `FS_TOO_LARGE` instead of truncating or buffering without a bound. |
| `listDir(target, signal?)` | List direct directory children in stable name order. Returns entry names, entry types, resolved child targets, and cheap metadata (`version`/file `size` when available); never reads file contents. Missing targets throw `FS_NOT_FOUND`, non-directories throw `FS_NOT_DIRECTORY`, permission failures throw `FS_PERMISSION_DENIED`, and other backend I/O failures throw `FS_IO_ERROR`. Broken/disappeared children may be returned as `other` without metadata; child permission/IO failures fail the whole listing with the same structured codes. |
| `writeText(target, content, expected?, signal?)` | Atomic create/replace. `expected` is OPTIONAL: omit ⇒ unconditional create-or-overwrite; supply an `FsWriteIntent` (`createIfAbsent`/`replaceIfVersion`) to guard. `createIfAbsent` must perform a no-replace publication so a creator racing the initial probe is preserved. |
| `editText(target, edit, expected?, signal?)` | Literal edit. `expected` is OPTIONAL: omit ⇒ unconditional edit of the current content; supply `{ version }` to guard (verified BEFORE matching). A missing target reports `FS_STALE_VERSION` either way. Applies and writes atomically — one mutation critical section. |

The mutation runs inside the backend's per-target lock either way, so an unconditional write/edit is still atomic — "unconditional" drops the *version* precondition, not the atomicity.

## The `fs/*` policy events

This package declares three events (see the generated region of [filesystem.md](../../../docs/subsystems/filesystem.md#cordis-surface)) so the emitter (`@deepseek-ai/dsh-tool-fs`) and the policy listener (`@deepseek-ai/dsh-fs-observation-policy`) share a vocabulary without the emitter depending on the policy plugin. `fs/write-intent` and `fs/edit-intent` are single-slot decision waterfalls (the listener fully decides, never calling `next()`); `fs/observed` is a fire-and-forget recording event carrying an `FsObservation` discriminated union: present with a version or confirmed absent. They carry only `dsh-fs` vocabulary plus an opaque `object` actor — no model-facing concepts and no agent/session owner structure.

## A provider contract, not the policy layer

`ctx.fs` is deliberately close to fsspec-style storage primitives — half a level above byte-level `cat`/`open`, because it decodes text and rejects binaries so the policy layer never touches raw bytes. It owns UTF-8 decoding, binary rejection, atomic writes, and the literal-edit critical section. It does **not** own line windows, numbered lines, rendered footers, or observed-state. Observed-state, read-before-edit, and version-guarded write/edit are policy a plugin (`@deepseek-ai/dsh-fs-observation-policy`) ADDS by supplying the optional guard — not provider behavior — so a sandboxed/remote backend inherits no model-facing observation policy.

`editText` stays on this seam (not composed in the policy layer from a read plus a write) because version guard + literal match + atomic rewrite must stay inside one critical section for correct error attribution and one-wins/one-stale concurrency, and a remote backend may implement it as a native compare-and-edit.

## Vocabulary

`FsTargetKey` / `FsVersion` are branded opaque ids ([the branded-ids Agent Note](../../../.agents/notes/implemented/architecture/2026-06-20-branded-ids.md)) — consumers must not parse `targetKey` or interpret `version`; only `displayPath` is for model/UI output. `FsObservation` distinguishes `{ kind: 'present', version }` from `{ kind: 'absent' }`, so a policy can separate an unseen target from confirmed absence without performing I/O. `FsWriteIntent` is the explicit GUARDED write intent (`createIfAbsent` creates a missing target and rejects an existing one with `FS_NOT_OBSERVED`; `replaceIfVersion` replaces only at the observed version, else `FS_STALE_VERSION`); omitting it from `writeText` is the third, unconditional state. `FsPathInfo` is the no-follow metadata shape that can report `symlink`, unlike target-level `FsInfo`. Failures throw `FsError` (extends `HarnessError`, [the structured error taxonomy Agent Note](../../../.agents/notes/implemented/architecture/2026-06-11-structured-error-taxonomy.md)) carrying a stable `FsErrorCode` (`FS_NOT_FOUND`, `FS_NOT_DIRECTORY`, `FS_NOT_TEXT`, `FS_NOT_REGULAR_FILE`, `FS_TOO_LARGE`, `FS_PERMISSION_DENIED`, `FS_IO_ERROR`, `FS_STALE_VERSION`, `FS_NOT_OBSERVED`, `FS_AMBIGUOUS_EDIT`, `FS_EDIT_NOT_FOUND`, `FS_ABORTED`); the tool registry exposes `{ name, code }` on `isError` results. See `src/types.ts` for the full contracts.

## Model Experience

Indirectly, through `dsh-tool-fs`, which renders provider text and errors as bounded, retained filesystem tool results.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Text-only mutations by contract** — text reads and both mutations reject binary/non-UTF-8 content with `FS_NOT_TEXT`; `readBytes` is the one raw-byte primitive, and binary-safe mutations remain a deliberate deferral of [the tool-schemas Agent Note](../../../.agents/notes/implemented/feature/2026-06-17-filesystem-tool-schemas.md).
- **Twelve primitives only** — no delete, rename/move, copy, or watch; `listDir` is single-level, with recursion, globbing, pagination, and search out of scope per [the directory-listing Agent Note](../../../.agents/notes/archived/architecture/2026-07-03-filesystem-directory-listing-seam.md).
- **No IO deadline** — the seam arms no timeout; cancellation is a best-effort optional `AbortSignal` per primitive (the deliberate [fs-family stance](../README.md)).
- **Resolve-then-operate costs a remote backend two round-trips per tool call** — folding or caching resolution is left to such a backend.
