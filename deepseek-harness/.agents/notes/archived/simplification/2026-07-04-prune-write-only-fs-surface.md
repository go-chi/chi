# Agent Note: Prune write-only fields and a dead routing knob from the fs seam

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-04-prune-write-only-fs-surface.zh.md)

## Problem

The [fs seam split](2026-06-26-fsspec-style-fs-seam.md) moved read routing and policy out of the backend into `dsh-tool-fs` and `dsh-fs-policy`. Four pieces of surface kept the pre-split shape — populated on every call, read by nobody:

1. **`STREAM_MIN_SIZE` + `FsIoInternals.streamMinSize` in `dsh-fs-local`** — *removed ahead of this change by the no-hardcoded-tunables audit, which made the routing bound `dsh-tool-fs`'s `readStreamMinSize` config; recorded here as part of the full prune.* Originally (`packages/fs/fs-local/src/fsio.ts`, re-exported from `packages/fs/fs-local/src/index.ts`): zero readers anywhere, including fs-local's own source and tests. The backend has no read routing — `readWholeText`/`streamWholeText` are separate primitives the caller chooses between — and the real routing constant lives in the consumer (`packages/fs/tool-fs/src/read.ts`, compared against `info.size`). Two mirrors of the 10 MiB fact; the backend's was dead, and the knob's JSDoc claimed a "read routing" override that did not exist.
2. **`FsTarget.inputPath`** (`packages/fs/fs/src/types.ts`): every backend and every test fake had to fabricate a "diagnostics only" value with zero production readers — the policy plugin and every error message use `targetKey`/`displayPath`. The `listDir` producer exposed the semantic wobble: directory children got the bare entry name, which was nobody's "input".
3. **`FsEditOutcome.replacements` + `.replaceAll`** (`packages/fs/fs/src/types.ts`): `replacements` had zero production readers (the single-match policy itself stays — it is enforced by the `FS_AMBIGUOUS_EDIT`/`FS_EDIT_NOT_FOUND` throws inside the backend, whose error message keeps the internal count); `replaceAll` was read only by `formatEditOutput` in `packages/fs/tool-fs/src/edit.ts` — as an echo of the `replace_all` argument the tool already holds. Shrunk, `FsEditOutcome` is `{ version, before, after }`, parallel to `FsWriteOutcome`'s genuinely backend-discovered fields.
4. **`FileReadOutcome.limit` + `.version`** (`packages/fs/tool-fs/src/read-render.ts`): populated by the read tool, but `formatReadOutput` renders `offset`/`lines`/`totalLines`/`truncatedByBytes` only, and the `fs/observed` emit uses `info.version` directly rather than an outcome copy.

## Decision

Delete the fs-local constant, its re-export, and the `streamMinSize` knob (the remaining `FsIoInternals` knobs are genuinely used by the atomic-write tests); drop `inputPath` from `FsTarget`; shrink `FsEditOutcome` to `{ version, before, after }` and pass `replaceAll` to `formatEditOutput` from the parsed args; drop `limit`/`version` from `FileReadOutcome`. The [filesystem.md](../../../../docs/core-data-structures/filesystem.md) pastes, `packages/fs/fs/README.md`, and the test fakes that had to fabricate the removed fields shrink with the types.

## Alternatives considered

### Why not keep them?

A future permission/containment layer might want the pre-resolution path for error text — but it would want the *request*, which every call site still holds. "N occurrences replaced" might become model-facing text — a behavior change to design when wanted, and the backend-internal count survives for its error message. A read footer might display `limit` — everything the footer shows already derives from `lines`/`totalLines`. Meanwhile every current and future backend (remote, native) would have to fabricate wire fields nobody consumes, and every test fake would have to satisfy them.

## Verification

The removed surfaces are gone — `STREAM_MIN_SIZE`/`streamMinSize` in `dsh-fs-local`, `FsTarget.inputPath`, `FsEditOutcome.replacements`/`.replaceAll`, and `FileReadOutcome.limit`/`.version` — while the request-side `replaceAll` (`FsEditRequest`) and the version fields on the other outcome types are untouched; the test fakes shrank with the types. `formatEditOutput`'s emitted text is unchanged for both `replace_all` branches, so no snapshot expected output churned.

## Consequences

Backends gain no new obligations; they shed four fields nobody consumed. The fs discovery work (glob/grep tools) touches the same `dsh-fs` type files — a textual, not design, overlap that reconciles mechanically.
