# @deepseek-ai/dsh-fs-e2b

English | [中文](README.zh.md)

E2B implementation of the [`@deepseek-ai/dsh-fs`](../../fs/fs/README.md) provider contract. It has no config: load [`@deepseek-ai/dsh-e2b`](../e2b/README.md) first, then this service in place of `dsh-fs-local`. The provider uses the owner's remote cwd and SDK handle, so file tools observe the same world as E2B-backed Bash processes.

## Behavior

- **Remote identity and metadata** — relative paths resolve as POSIX paths against the caller cwd or `ctx.e2b.cwd`; GNU `realpath -mz` supplies canonical target identity without requiring the final file to exist, and ASCII/base64 plus strict NUL framing preserves newline and multibyte paths across the decoded SDK transport. `stat`, no-follow `lstat`, and stable one-level directory listings project E2B metadata into the filesystem seam; listings reuse returned metadata and resolve symbolic-link entries sequentially. Versions are opaque hashes of E2B metadata plus a per-write extended attribute.
- **Execution-world paths** — canonical targets expose absolute POSIX process paths, percent-encoded `file:` URIs, and provider-owned containment checks, so generic subprocess consumers never parse E2B target ids or apply host path rules.
- **UTF-8 reads** — whole reads and streamed reads preserve cross-chunk decoding, reject invalid UTF-8, and use the seam's 8192-byte NUL sample for binary detection. The model-facing tool still owns size selection and line windowing.
- **Bounded raw-byte reads** — `readBytes` short-circuits on the stat size before any content transfer, then streams the remote object and cancels the stream at the first chunk past `maxBytes` (`FS_TOO_LARGE`), so neither an at-rest oversized file nor a post-stat grower is buffered whole in host memory. The empty-file quirk of the pinned SDK (content-length 0 returns `''` in stream format) yields an empty result.
- **Atomic mutations** — writes create a random sibling staging directory, change it to mode `0700` before uploading content, and preserve an existing file's POSIX mode. Replacements publish through E2B's same-filesystem atomic rename. A guarded `createIfAbsent` publishes with remote `ln -T` instead, making the commit atomically no-replace even when a directory appears at the destination; metadata read from the staged file before that commit is projected to the target path for the returned version, so no fallible metadata request follows either commit point. E2B creates missing parent directories. Literal edits LF-normalize for matching, restore dominant CRLF storage, and serialize mutations per canonical target within the host process.
- **Failures and cancellation** — E2B not-found, permission, abort, and other controller failures map to the existing `FsError` vocabulary. Cancellation is best-effort at earlier SDK request boundaries and checked immediately before publication. The signal is not forwarded into the rename or guarded-link commit, so cancellation cannot interrupt atomic publication or turn a committed write into a reported failure.

The provider does not copy, mount, or reconcile the host workspace. Giving it a host path as `cwd` creates a remote directory with the same spelling only.

## Model Experience

Indirectly, through [`dsh-tool-fs`](../../fs/tool-fs/README.md), which renders remote UTF-8 content, directory results, mutation acknowledgements, and provider errors while E2B identity and transport remain internal.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **No host synchronization** — an empty E2B cwd stays empty until a tool, command, or external process populates it; local files are neither uploaded nor reflected back.
- **Mutation coordination is host-process-local** — `createIfAbsent` preserves a remote creator racing publication, but another harness connection or command can still race replacement; version guards detect only metadata changes represented by E2B.
- **Reads reopen canonical targets by path** — a concurrent remote path replacement between resolution and stream opening is not fenced by a stable file handle; no observed product defect justifies a provider-specific bounded-read protocol in this POC.
- **Whole-file mutation costs remain** — overwrite diffs and literal edits read complete files into host memory, and every operation incurs E2B controller latency.
- **The POC targets E2B's default Linux image** — it relies on GNU `realpath`/`base64`/`chmod`, same-filesystem rename, streaming reads, and metadata extended attributes; custom templates are outside this POC.
