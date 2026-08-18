# @deepseek-ai/dsh-tool-fs-search

English | [中文](README.zh.md)

The **model-facing filesystem discovery tools**—`glob`, `grep`—are backed by the **packaged ripgrep binary** (`@vscode/ripgrep`), not by `ctx.fs` provider methods and not by a system `rg` install. Registration is unconditional: the binary ships inside the npm dependency, so there is no load-time availability probe. Each call spawns the binary through the `ctx.subprocess` seam with a fixed argv vector (`--no-config` prepended so a host `RIPGREP_CONFIG_PATH` cannot inject a `--pre` preprocessor into the unconfined spawn; model-controlled values are plain argv elements — no shell layer exists, so no quoting applies), parses the raw `rg` output, and returns a workdir-relative canonical value. The package injects `tools`, `systemPrompt`, and `subprocess`—deliberately **not** `fs`; `ctx.spillStore` is read opportunistically with `ctx.get()` because formatted-result spill is optional.

```ts ignore-check
// A deployment chooses how over-cap glob pages are selected.
await ctx.plugin(LocalSubprocessRuntime)                     // @deepseek-ai/dsh-subprocess-local
await ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: false })
// Optional: a spill backend makes capped results fully recoverable.
await ctx.plugin(LocalSpillStore)                           // @deepseek-ai/dsh-spill-local
```

Why spawn-backed: local workspace discovery is naturally a process-backed `rg` workflow, and putting search on `ctx.fs` would force every filesystem backend to grow a search API. The subprocess seam owns spawn execution, process-tree termination, environment scrubbing, and bounded output capture; this package owns schemas, argument validation, argv construction, parsing, retention, formatted-result spill, and timeout declaration. The tools never expose a background job — the call returns only after `rg` exits, is terminated by the cooperative timeout, is aborted, or fails.

## Deployment requirement: no host rg, co-located workdir/filesystem

The binary ships with the package on every supported platform (macOS/Linux/Windows, x64/arm64), so no host `rg` install is required and the tools register on every deployment. Returned paths are displayed relative to the resolved workdir (the calling agent's session cwd when present, else `process.cwd()`) and are follow-up-readable with `read` only when that workdir and the filesystem root are the same workspace. That co-location requirement carries no runtime cross-service validation; remote or virtual filesystem search waits for a shared workspace contract or a provider-specific search backend.

## Config

`sampleOverCapGlobResults` is required and has no fallback; deployments choose the over-cap ordering contract explicitly. The remaining keys are optional search caps with the defaults below.

| Key | Default | Meaning |
|---|---|---|
| `sampleOverCapGlobResults` | none (required) | `true` samples an over-cap `glob` page across top-level entries; `false` keeps the modification-time-ordered head. When formatted spill succeeds, both modes preserve the complete sorted list in that artifact. |
| `globMaxResults` | `100` | Max paths one `glob` call shows inline (matches Claude Code's `GlobTool` limit). A result within the cap remains complete and modification-time ordered. |
| `grepMaxMatches` | `250` | Max flat matches one `grep` call retains inline (matches Claude Code's `GrepTool` `head_limit`); later matches go to the formatted spill artifact. |
| `grepMaxLineBytes` | `2000` | Byte cap per matched-line preview; the cut preserves UTF-8 boundaries and is marked `(line truncated)`. |
| `rawOutputMaxBytes` | `20000000` | Max complete raw `rg` stdout a search will parse (matches Claude Code's ripgrep raw buffer); larger raw output fails with `SEARCH_RAW_OUTPUT_OVERFLOW`. |
| `timeoutMs` | `30000` | Cooperative tool-call budget attached to both tool definitions, enforced by `@deepseek-ai/dsh-tool-call-timeout-policy` through `exec.signal`; the subprocess seam's terminate escalation is the hard kill. |
| `graceMs` | `3000` | Positive terminate-escalation grace the subprocess seam grants past `timeoutMs` before the search fails as `SEARCH_ABORTED`; it cannot exceed [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md). |
| `stderrMaxBytes` | `65536` | Diagnostic-tail budget for `rg` stderr, captured through the subprocess seam's collect disposition; a lossy read keeps only the tail (marked `[stderr truncated]`). |

## Tools

| Tool | Arguments | Behavior |
|---|---|---|
| `glob` | `pattern`, `path?` | `rg --files --glob <pattern> --sort=modified --no-ignore --hidden` plus VCS metadata excludes (`.git`, `.svn`, `.hg`, `.bzr`, `.jj`, `.sl`). `path` is an optional **directory** search root; omitted means the resolved workdir. Returns one FILE path per line; `rg --files` never emits directory entries. The pattern keeps ripgrep semantics: without a `/` it matches the basename at any depth, so `*` matches the whole tree. Complete results stay modification-time ordered; over-cap presentation follows `sampleOverCapGlobResults`. |
| `grep` | `pattern`, `path?`, `include?` | Line-oriented `rg --json` parse (no colon-splitting ambiguity). `pattern` is a ripgrep regex; `path` is an optional **file or directory** target; `include` is ONE positive glob filter — a comma-separated list or a negated (`!…`) value is rejected up front (brace alternation like `*.{ts,tsx}` is fine). Returns matches grouped by file as `Line N: <preview>`. |

Routine budgets stay out of the model-facing schema (no `head_limit`/`offset`/`case_insensitive`/output modes): a model that needs surrounding context reads the matched file with `read`; one that needs later results follows the returned spill locator's retrieval hint.

## Two budgets, two artifacts

Raw `rg` stdout and stderr are internal transport details. Each search requests collect-mode budgets from the subprocess seam — complete stdout within `rawOutputMaxBytes` and a `stderrMaxBytes` diagnostic tail — with no spill files on either stream (the tool never reads a raw spill path). If the seam still reports a lossy stdout read, the search fails with `SEARCH_RAW_OUTPUT_OVERFLOW` and tells the model to narrow the query; a lossy stderr read only marks the diagnostic excerpt `[stderr truncated]`. A successful `glob` keeps the displayed search root and every acquired path in `{ root, paths }`; when sampling is enabled, `root` lets the Native renderer group an explicit relative or absolute search path by entries beneath that root rather than by its workdir prefix. `grep` keeps every acquired `{ path, lineNumber, line }` in `{ matches }`. Inline item and per-line preview caps apply only in the Native renderer. For a direct surface call with more logical results than the inline cap, post-policy best-effort saves the complete formatted preview through `ctx.spillStore.saveText()` and replaces only presentation with the configured page plus locator. Nested Code dispatches skip that spill because their full canonical value does not enter model context. Missing/failed spill keeps the inline page and reports that the complete result could not be saved—never an `isError`.

## Errors

Search failures carry the package-owned `SearchError` (a `HarnessError` subclass), surfaced as `{ name, code }` on `isError` results: `SEARCH_INVALID_PATTERN` (ripgrep rejected the regex/glob), `SEARCH_FAILED` (a failed `rg` launch, inaccessible target, signal kill, malformed `--json` output), `SEARCH_RAW_OUTPUT_OVERFLOW` (raw output over `rawOutputMaxBytes`, or still lossy after the requested stdout capture budget), and `SEARCH_ABORTED` (cooperative tool timeout or caller cancellation). ripgrep exit semantics are tool-owned: exit 0 is success with results, exit 1 is a successful empty search (`No files found` / `No matches found`), and only other exits are failures. Model argument mistakes (blank pattern, a list-valued `include`) stay ordinary tool argument errors.

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the independently registered glob and grep guidance below. Agent-scoped tool restrictions can hide either schema without removing its prompt section.

##### Glob guidance with `sampleOverCapGlobResults: true`

```markdown
Use the glob tool — not shell find — to discover files by path pattern. A pattern with no "/" matches basenames at any depth, so "*" matches every file in the tree rather than its top level. Results are files only, never directories, and include hidden and ignored files: a result that fits comes back in modification-time order, while a larger one is sampled across top-level entries, so it spans the tree instead of one subtree.
```

##### Glob guidance with `sampleOverCapGlobResults: false`

```markdown
Use the glob tool — not shell find — to discover files by path pattern. A pattern with no "/" matches basenames at any depth, so "*" matches every file in the tree rather than its top level. Results are files only, never directories, and include hidden and ignored files: a result that fits comes back in modification-time order, while a larger one keeps the modification-time-ordered head.
```

##### Grep guidance

```markdown
Use the grep tool — not shell grep or rg — to search file contents. Use read on a matched file when you need surrounding context.
```

#### Token effect

Fixed guidance cost per request while the tools are registered; the required sampling choice selects one glob variant.

#### KV Cache effect

Prefix-stable while the plugin scope, sampling choice, and guidance text are unchanged. Activation, disposal, or changing the choice may invalidate reuse from this prompt section.

### Tool schemas

#### What the model sees

The glob description states the configured over-cap ordering. The generated [`glob` and `grep` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-fs-search) use `sampleOverCapGlobResults: true`; the tools are registered unconditionally.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged. Registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results and spill notices

#### What the model sees

`glob` returns one path per line; `grep` groups `Line <line>: <preview>` matches beneath each path. Empty searches return `No files found` or `No matches found`. A capped result ends with its omission count plus the spill locator and backend retrieval hint, or says the complete result could not be saved. With `sampleOverCapGlobResults: true`, an over-cap `glob` page takes paths round-robin across entries immediately beneath the actual search root, and the footer states the sampled basis and how many top-level entries it reached; when it cannot reach them all, the footer tells the model to narrow `path`. With `false`, the page is the modification-time-ordered head and keeps the plain capped-result footer. A result that fits inline is untouched, and a flat sampled result also keeps the plain footer because its sample equals the modification-time head. The spill artifact always holds the complete list in modification-time order.

#### Token effect

Inline paths and matches are bounded by `globMaxResults`, `grepMaxMatches`, and `grepMaxLineBytes`; the call and retained result remain in history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Tool errors

#### What the model sees

Failures are normalized as `Error: <message>` with structured `SEARCH_INVALID_PATTERN`, `SEARCH_FAILED`, `SEARCH_RAW_OUTPUT_OVERFLOW`, or `SEARCH_ABORTED` metadata for callers.

#### Token effect

Only a failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Search and file access have no shared-workspace proof** — returned paths are follow-up-readable only when the workdir and filesystem root denote the same workspace; the package performs no runtime cross-service validation.
- **The packaged binary is fixed at dependency version** — `@vscode/ripgrep` covers the platforms it ships (macOS/Linux/Windows, x64/arm64); an unsupported platform or a corrupted install fails calls with `SEARCH_FAILED`. Remote or virtual filesystems need a co-located workspace or another search consumer.
- **The schemas expose one bounded page** — offset pagination, case-mode switches, alternate output modes, and provider-backed discovery remain outside this package; capped complete output requires a spill backend.
- **Sampling, when enabled, groups by first path segment beneath the search root only** — an over-cap `glob` page balances across those top-level entries, so a result concentrated deeper (one busy directory inside an otherwise even tree) is still shown unevenly below that level; recursive balancing is deferred.
