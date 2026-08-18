# Agent Note: Add direct directory listing to the filesystem seam

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-03-filesystem-directory-listing-seam.zh.md)

## Problem

`@deepseek-ai/dsh-fs` is the provider seam for filesystem access, with local and future non-local backends behind the same `ctx.fs` contract. Before this change it could resolve paths, stat targets, read text, stream text, write text, and edit text. That was enough for model-facing file tools, but not for non-model-facing consumers that need to enumerate directories without importing `node:fs`.

The immediate pressure came from skill loading: reading an individual `SKILL.md` can already go through `ctx.get('fs')`, but discovering which skill roots contain `<name>/SKILL.md` or `<name>.md` still needs directory enumeration. Adding directory listing only in `dsh-skill` would either keep a direct Node dependency there or invent a one-off local helper outside the filesystem provider stack.

This decision adds the provider capability without a model-facing `ls`/`list` tool or skill-discovery change. Those consumers require separate UX, prompt, and policy decisions.

## Decision

Add `FileSystem.listDir(target, signal?)` to `@deepseek-ai/dsh-fs`.

`listDir` lists one directory level only. It returns direct children in stable name order and includes:

- `name`: the child basename.
- `type`: `file`, `directory`, or `other`.
- `target`: the resolved child `FsTarget`.
- `version`: cheap metadata when available.
- `size`: regular-file size when available.

It never reads file contents. Recursive traversal, globbing, pagination, search, file watching, and model-facing rendering are intentionally out of scope.

The local backend implements this through `readdir({ withFileTypes: true })`, `resolveLocalTarget`, and metadata `stat`/`realpath` probes. The result order is deterministic (`name.localeCompare`) to keep prompt/listing output stable for future consumers and improve prefix-cache reuse.

Broken or disappeared children may be represented as `type: 'other'` without `version`/`size`; they do not abort the whole listing. Permission or backend I/O failures while listing the directory or resolving/probing child metadata fail the whole listing with structured `FsError` codes:

- `FS_NOT_FOUND` for missing targets.
- `FS_NOT_DIRECTORY` for existing non-directory targets.
- `FS_PERMISSION_DENIED` for permission failures.
- `FS_IO_ERROR` for other backend I/O failures.
- `FS_ABORTED` for aborted calls.

## Alternatives considered

**Add a model-facing list tool with the seam.** Rejected because its prompt, schema, and rendering contracts are independent of the provider primitive.

**Keep directory enumeration in each consumer.** Rejected. That would bind product packages such as `dsh-skill` to Node/local filesystem behavior and bypass policy/remote/sandboxed backends.

**Make `listDir` recursive or glob-shaped.** Rejected for now. Skill-root discovery only needs direct children, and a simple direct listing is the smallest backend contract future consumers can safely compose.

**Skip children that fail metadata resolution.** Rejected. The API promises resolved child targets, so permission/IO failures while resolving a child are contract failures. Broken or disappeared children are the exception because they can still be represented without claiming a live resolved file.

## Consequences

Every filesystem backend must now implement one additional provider primitive. That is deliberate foundation work while the harness is still unreleased, but it does mean future sandboxed/remote backends need to define equivalent direct-child listing behavior.

The capability remains provider-facing. Until a consumer lands, ACP/model sessions will still need existing tools such as `bash` for directory listing. The absence of a model-facing `listdir` tool is expected, not a wiring failure.
