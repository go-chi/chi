# @deepseek-ai/dsh-settings-file

English | [中文](README.zh.md)

File-backed settings provider. One YAML or JSON document carries every namespace section; external edits hot-publish through `ctx.settings`, and `update()` re-reads the document under a writer lock before writing back atomically, preserving the user's YAML comments, any section owned by a plugin that is not currently loaded, and any on-disk change this process has not observed yet.

## Config

| Field | Meaning | Default |
|---|---|---|
| `path` | Settings document path; extension picks the format (`.yaml`/`.yml`/`.json`) | `settings.yaml` under the harness home |
| `dshHome` | Harness home used when `path` is omitted | `$DSH_HOME` or `~/.dsh` |
| `watch` | Watch the document and hot-publish external edits | `true` |
| `debounceMs` | Watcher write-settle window in milliseconds | `100` |

Defaulting is one explicit `resolveSpec(config)` step; an unsupported extension fails at load.

## Behavior

- **Boot fails loud, reload keeps last-good.** An existing-but-invalid document fails plugin load; once live, an unreadable or unparsable edit warns and keeps the last good sections. A missing document resolves every namespace from defaults and `base`; deleting it publishes the same empty state.
- **Every write is a read-modify-write.** A persist first re-reads the document and publishes any difference into the seam — an external edit still inside the watcher debounce window, a change the watcher missed, or another process's write — then renders against that fresh text, so a write can never resurrect a stale document or drop an unobserved sibling section. If the on-disk document turned invalid, the write rejects loud instead of overwriting the user's manual edit.
- **Writes hold a cross-process writer lock.** The read-render-rename cycle runs under a `wx`-created `<file>.lock` sibling with exponential backoff and a 2 s acquisition deadline. A contender times out without removing the existing lock because age cannot distinguish a crashed owner from a paused live writer; orphan recovery is an operator action. Readers never take the lock: the rename commit is atomic, so reloads are always consistent.
- **Write-back is atomic, owner-only, and symlink-proof.** The render exclusive-creates a random-suffix temp sibling with mode `0600` (`wx` refuses to follow a planted symlink) and renames over the target, cleaning the temp up on failure.
- **YAML edits are leaf-level diffs.** A write sets only the values that changed and deletes only the keys that were removed, so comments, anchors, and formatting survive on every untouched node and on the key of every changed pair; a changed array (or other non-map value) replaces wholesale, taking comments inside it along. JSON re-serializes without comments.
- **Reloads and writes share one operation chain.** Watcher refreshes and persists from every namespace queue run one at a time in queue order; each render sees the text the previous operation committed.
- **The watcher's ready signal reconciles once.** The initial load races the watcher's own setup, so a change written in between never fires an event; the reconcile at ready closes that startup gap.
- **The native watcher receives a canonical path.** Before Chokidar opens the target, the provider realpaths its deepest existing ancestor and restores any missing suffix. File access and user-facing diagnostics retain the configured path, while Windows cannot mix an 8.3 alias with long-form event paths inside libuv.
- **Dispose quiesces in every watch mode.** Teardown marks the provider closed, closes the watcher when present, then waits out every queued or in-flight document operation, so nothing publishes after disposal.
- **Self-write suppression by content.** The provider caches the last good text; a watcher event whose content equals the cache (its own write included) is a no-op.
- **Host configuration adapters receive the resolved path.** `ctx.settings.documentPath` is the absolute `resolveSpec()` filename, including a custom YAML/JSON path; `prepareDocument()` preserves an existing file or exclusively creates an absent empty file with owner-only permissions before the Host opens it. The browser receives only an availability flag, never reconstructs `$DSH_HOME`, and never submits a filesystem target.

## Model Experience

Indirectly, through consumers of `ctx.settings`: this provider only stores and publishes namespace sections, and each consumer's own surface documents any model effect.

#### KV Cache effect

No direct invalidation; the consuming plugin owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Same-namespace conflicts stay last-write-wins** — the writer lock and read-modify-write keep concurrent writers from dropping each other's namespaces, but two writers editing one namespace still resolve to the later write; there is no per-value merge or revision check.
- **A missed watcher event stays unseen until the next signal** — reads never re-stat the file, so a change the watcher fails to report is only folded in by the next event, the next write, or a restart.
- **Comment preservation is YAML-only and map-shaped** — JSON documents re-serialize without comments (JSON has none), and comments inside a changed array (or attached inline to a changed scalar value) go with the value they described.
- **No value indirection** — sections hold literal values; `${env:VAR}`-style references for secrets are a deferred seam-level feature.
