# @deepseek-ai/dsh-fs-local

English | [中文](README.zh.md)

The **local-filesystem implementation** of the `ctx.fs` provider contract ([`@deepseek-ai/dsh-fs`](../fs)). Backs the twelve `FileSystem` primitives with the host filesystem; loading it as a plugin populates `ctx.fs`.

```ts ignore-check
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'

await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
// ctx.fs uses the local backend; load @deepseek-ai/dsh-fs-observation-policy for the
// freshness policy gate and @deepseek-ai/dsh-tool-fs to expose read/write/edit.
```

## Behavior

- **`resolve(path, opts?)`** — a relative `path` resolves against `opts.cwd` when the caller supplies one (the model-facing tools pass the calling agent's session cwd — see [the per-session cwd Agent Note](../../../.agents/notes/implemented/architecture/2026-07-02-fs-per-session-cwd.md)), else `config.cwd` (default `process.cwd()`); an absolute `path` ignores both. `opts.signal` is checked before and after local resolution, while a remote sibling backend may use it to abort its round-trip. The `targetKey` is the file's `realpath`, so two input paths reaching the same file through symlinks share one identity, and writes/edits land on the link target (preserving the link). A not-yet-existing path uses the realpathed parent directory plus basename when the parent exists; only an unresolvable parent falls back to the absolute path. `displayPath` is the absolute (un-resolved) path.
- **Execution-world coordinates** — `processPath` exposes the target's canonical host path, `fileUrl` encodes that path through Node's platform-aware URL conversion, and `contains` uses platform path semantics to test identity or descendant containment without consumers parsing `targetKey`.
- **`stat` / `lstat`** — return target metadata or `undefined` when absent. `stat` reports `FsInfo` for an already resolved target (`version` = an opaque token derived from bigint `dev:ino:size:mtimeNs:ctimeNs`, `type` of `file`/`directory`/`other`, byte `size`); path-shaped `lstat` reports `FsPathInfo` without following the final symlink and can therefore return `symlink`. Both check cancellation before and after their asynchronous metadata probe, so an abort that lands in flight reports `FS_ABORTED` rather than stale absence.
- **`readText` / `streamText`** — UTF-8 only. `readText` reads the whole file; `streamText` decodes chunks so a huge file need not be held whole in memory and consumers can enforce their own retention bounds. Both reject invalid UTF-8 and NUL-byte binary samples (`FS_NOT_TEXT`) and non-regular targets. The `read` tool (`@deepseek-ai/dsh-tool-fs`) owns line windowing.
- **`readBytes`** — raw whole-file bytes with no decoding or binary rejection (the `read_image` tool validates content through the attachment service). The required byte cap short-circuits on the stat size before any content I/O; the subsequent stream reads at most one byte beyond the cap, so a file growing after stat still fails `FS_TOO_LARGE` without unbounded buffering.
- **`listDir`** — lists one directory level in stable `name.localeCompare()` order. Each entry carries the child basename, type, resolved child target (`displayPath` under the listed directory, `targetKey` as the realpath identity), and cheap stat metadata (`version`, plus `size` for regular files). It never opens or decodes file contents. Missing targets report `FS_NOT_FOUND`, file/special-file targets report `FS_NOT_DIRECTORY`, aborted calls report `FS_ABORTED`, permission failures report `FS_PERMISSION_DENIED`, and other listing or child metadata I/O failures report `FS_IO_ERROR`. Broken/disappeared children are returned as `other` without metadata, but permission/IO failures while resolving a child fail the whole listing with a structured `FsError`.
- **`writeText`** — atomic: writes to a temp file opened exclusively (`wx`, `0o600`) inside a randomly-named private staging dir (`0o700`) next to the target, then fsyncs and publishes. An existing file's mode is preserved, while new files default to `0o600`; on Windows a new file inherits the destination directory's DACL, while replacement copies the target DACL onto the empty temp before writing and publishes through `ReplaceFileW` so the original access policy survives ([Windows DACL preservation Agent Note](../../../.agents/notes/implemented/bug-fix/2026-07-19-windows-atomic-write-dacl-preservation.md)). The `expected` guard is OPTIONAL: omitting it unconditionally creates-or-overwrites; `createIfAbsent` hard-links the staged file into place as an atomic no-replace publication, so a regular file created after the initial probe is preserved and rejected with `FS_NOT_OBSERVED`, while a non-regular path entry is preserved and rejected with `FS_NOT_REGULAR_FILE`; `replaceIfVersion` replaces only at the observed version (a missing target or mismatch is `FS_STALE_VERSION`). An overwrite returns the prior text as its contextual diff basis only when both the opened prior file and UTF-8 replacement are strictly below `config.diffBasisMaxBytes` (default 10 MiB). The descriptor read enforces that limit even if an external writer replaces or changes the file size after the initial probe. Otherwise the provider returns `before: null`, so presentation uses its whole-file fallback.
- **`editText`** — atomic literal read-modify-write over the same primitive, serialized per target by a mutation lock. The `expected` guard is OPTIONAL: when supplied it verifies the version BEFORE literal matching (a stale edit reports `FS_STALE_VERSION`, never `FS_EDIT_NOT_FOUND`/`FS_AMBIGUOUS_EDIT` against newer content); omitting it edits the current content unconditionally. A missing target reports `FS_STALE_VERSION` either way. LF-normalizes for matching, restores the file's dominant CRLF/LF style, and rejects empty `oldString` / zero matches (`FS_EDIT_NOT_FOUND`) or ambiguous multi-matches without `replace_all` (`FS_AMBIGUOUS_EDIT`).

The package-root SDK API is the default/named `LocalFileSystem` class plus `Config`. Raw I/O lives in `src/fsio.ts` (Cordis-free, independently unit-tested); `src/index.ts` is the thin service wiring.

## Model Experience

Indirectly, through [`dsh-tool-fs`](../tool-fs/README.md), which renders this provider's line-windowed UTF-8 content, mutation acknowledgements, and exact provider messages in capped retained results while versions, atomic-write mechanics, and directory metadata remain internal.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **`config.cwd` is not a sandbox** — it is a resolution default, not containment: absolute paths and `..` escape it. Enforce containment with a stricter `ctx.fs` backend or a permission plugin on the `tools/execute` waterfall ([capability-seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-17-filesystem-capability-seam.md#consequences)).
- **Version tokens depend on filesystem metadata** — they combine device, inode, size, nanosecond mtime, and nanosecond ctime; a storage layer that cannot update any of those facts for a rewrite can still defeat the stale guard.
- **`editText` holds the whole file (plus the edited copy) in memory** — streaming exists only on the read path.
- **A sub-limit overwrite still buffers a contextual basis** — `writeText` may retain up to just below `config.diffBasisMaxBytes` of prior text in addition to the caller-owned replacement; the bound does not cap the returned `after` value or presentation's whole-file fallback.
- **Binary detection is asymmetric** — reads NUL-sample only the first 8192 bytes while edits scan the whole buffer, so a file with a late NUL reads fine but rejects edits.
- **The per-target mutation lock is in-process only** — guarded create still uses an atomic no-replace publication across processes, but replacement writers in another process are caught only when the optional version guard observes their metadata change; they are never serialized.
- **Guarded creation requires hard-link support** — filesystems or mounts that reject hard-link publication cannot serve `createIfAbsent`; the provider preserves the missing target and reports `FS_IO_ERROR`.
- **Post-commit cleanup is best effort** — a successful publication remains successful if removal of its owner-only staging directory fails, leaving private residue for later operator cleanup.
