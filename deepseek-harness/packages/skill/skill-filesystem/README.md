# @deepseek-ai/dsh-skill-filesystem

English | [中文](README.zh.md)

Local filesystem provider for the `ctx.skills` registry.

This package implements one skill source. It scans local project, custom, and user skill roots, parses `SKILL.md` or flat Markdown skill files, and registers the provider on `ctx.skills`. The registry remains in `@deepseek-ai/dsh-skill`; the durable session catalogs and model-facing loader tool remain in `@deepseek-ai/dsh-tool-skill`.

## Plugin

Requires `ctx.skills` (`inject: ['skills']`).

### Config

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `filesystem` | Unique name used to register this provider on `ctx.skills`. |
| `includeDefaultRoots` | `true` | Include project and user roots around `customSkillDirs`; set false for an isolated custom-root provider. |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | DeepSeek Harness config root resolved by [`@deepseek-ai/dsh-home-paths`](../../util/home-paths/README.md); scans `skills` under this directory. |
| `agentsHome` | `$DSH_AGENTS_HOME` or `~/.agents` | Shared agent config root scanned for compatible skills. |
| `customSkillDirs` | `[]` | Additional local skill roots scanned after project roots and before user roots. |
| `watch` | `true` | Watch host-local roots and invalidate the local provider when catalog membership or frontmatter may have changed. |
| `watchUsePolling` | `false` | Use Chokidar polling instead of native events for existing skill roots. |
| `watchStabilityThresholdMs` | `200` | Stable-write window for Chokidar `add` and `change` events. |
| `watchPollIntervalMs` | `100` | Chokidar polling/stability interval and missing-path probe interval. |
| `watchMaxProjects` | `128` | Maximum distinct project roots retained in the watcher LRU. |
| `watchFollowSymlinks` | `true` | Follow symbolic links while watching existing roots. |

## Discovery

Default roots are resolved in this provider's rank order:

| Rank | Source | Path |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |

The project root is the nearest ancestor containing `.git`; without one, the current cwd is used. The user DSH root skips its `.system` child so system-owned directories are not treated as normal user skills. `includeDefaultRoots: false` omits the project and user rows and the `$DSH_BUNDLED_SKILL_DIR` environment default while retaining explicitly configured custom and bundled roots, allowing several uniquely named isolated providers to see only their own roots. This provider supplies project and user skills; another provider may supply built-in system skills.

When `ctx.fs` is available, discovery lists roots through `ctx.fs.listDir`, reads skill files through `ctx.fs.readText`, and probes `.git` through the filesystem service. Full skill loads forward the lookup abort signal to filesystem metadata and content reads. Without a filesystem service, the provider falls back to abortable Node filesystem I/O so minimal local contexts can still load skills. Confirmed missing paths are valid empty state, malformed or non-text entries warn and skip, and unexpected discovery/read failures make the registry snapshot incomplete rather than replacing a last-good model catalog with a misleading deletion.

## Catalog Change Detection

Existing skill roots are watched with Chokidar. Before opening a native watcher, the provider realpaths the existing root or ancestor and restores the next missing segment; when `watchFollowSymlinks` is false and the root itself is a symbolic link, it preserves that final link so Chokidar can enforce the configured boundary. Discovery and diagnostics retain the configured path, while Windows cannot otherwise mix an 8.3 alias with long-form libuv events. The provider observes direct bundle directory additions/removals, flat Markdown additions/removals, and direct `SKILL.md` additions/removals/changes; `change` exists to rediscover catalog frontmatter such as `name` and `description`. Changes below `references`, `scripts`, `assets`, or other bundle resources do not invalidate the catalog. Events delivered in the same microtask batch collapse to one provider invalidation.

A root that does not exist is followed from the nearest existing ancestor one missing path segment at a time. The next segment is probed with `fs.watchFile`; once `.agents`, `skills`, or the configured root appears, observation advances until Chokidar can attach to the real root. Root deletion reverses this process, so deleting and recreating an entire skills directory remains observable. Project-scoped watchers are bounded by `watchMaxProjects`; revisiting an evicted project reattaches observation during discovery.

The first-party filesystem `write` and `edit` tools also synchronously invalidate the provider through `fs/observed` when their target could affect a watched skill entry. This fast path makes the next model step observe its own filesystem mutation without waiting for the host watcher. External IDE, Git, shell, and process changes rely on Chokidar or the missing-path probe. Existing-root watchers remain persistent until effect teardown so Chokidar owns asynchronous native error events; startup/runtime watcher failures are logged and retried. Discovery still scans readable roots and returns their candidates for direct loading, but marks the observation incomplete so it is not cached or published as an authoritative model catalog. Effect teardown closes every watcher and contains late callbacks.

## Skill Format

Skills can be single-level directory bundles (`<name>/SKILL.md`) or flat Markdown files (`<name>.md`). Nested `**/SKILL.md` discovery is deliberately excluded. Frontmatter is parsed as an open YAML object with the `yaml` package; this provider interprets required `name` and `description`, plus optional `whenToUse`, `metadata`, `disable-model-invocation`, and `user-invocable`. Names must be kebab-case.

The two invocation fields accept YAML booleans and the case-insensitive forms `true`/`false`, `yes`/`no`, `on`/`off`, and `1`/`0`. `disable-model-invocation: true` excludes the skill from model-facing catalogs and loaders; `user-invocable: false` excludes it from human-facing commands. Each omitted field defaults to permitting its surface, and the provider always emits both positive internal policy values, including when both keys are absent. A rejected camel-case spelling or a non-boolean invocation value drops the entire skill from discovery with a warning instead of discarding only that field or falling back to a permissive default. Invocation policy fails closed because ignoring invalid data could expose a skill on a disabled surface; wrong-typed optional `whenToUse` and `metadata` values are omitted because neither currently grants invocation.

The catalog and body have separate lifecycles. Discovery parses frontmatter to produce the summary. Every `skill(name)` load rereads and reparses the current file, so body edits need no hash, revision, cache invalidation, or proactive model notification. A frontmatter rename between discovery and loading rejects the stale name and invalidates the provider; the next catalog observation publishes the new name.

## Model Experience

Indirectly, through `dsh-tool-skill`, which renders this provider's invocable names and capped descriptions into the initial or replacement catalog and a selected current instruction body plus resource-base guidance into retained tool history while paths, provider ranks, and disabled skills remain hidden.

#### KV Cache effect

Watcher invalidation can cause the named consumer to append a replacement catalog to the existing request history. Body-only edits leave the catalog digest unchanged.

## Known Limitations and Deferred Work

- **Discovery is one level deep** — only `<root>/<name>/SKILL.md` and `<root>/<name>.md` are recognized; nested skill trees and package manifests are ignored.
- **Project scope is the nearest `.git` ancestor** — workspaces without that marker fall back to the supplied cwd, with no alternate project-root marker or monorepo subproject selection.
- **Malformed entries disappear with a warning** — the model catalog receives no per-skill diagnostic and cannot distinguish an absent skill from an invalid one; unexpected I/O failures preserve the last-good catalog instead.
- **Missing-root observation polls one path segment** — roots absent at startup use `fs.watchFile` at `watchPollIntervalMs` until Chokidar can attach, trading bounded detection latency for reliable creation detection across IDE, Git, and shell workflows.
- **No body revision protocol** — a loaded body is ordinary retained tool history; later file edits affect later calls but neither rewrite old results nor announce that the body changed.
