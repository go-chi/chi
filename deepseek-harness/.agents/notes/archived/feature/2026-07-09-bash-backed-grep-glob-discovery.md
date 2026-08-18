# Agent Note: Bash-backed grep and glob discovery tools

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-09-bash-backed-grep-glob-discovery.zh.md)

## Problem

The harness needs model-facing `glob` and `grep` tools, but making them `ctx.fs` provider methods turns a local product convenience into a universal filesystem backend contract. Local workspace discovery is naturally a process-backed `rg` workflow; remote or virtual filesystem backends may expose their own search API, may not share a local `ripgrep` view, or may not support discovery at all. The v1 should not require every filesystem backend to implement search before the file read/write/edit seam has proven that need.

Search output also has two distinct budgets. The tool needs enough raw `rg` output to compute a stable logical result, but the model should receive only a bounded preview plus a recovery path when the formatted result is larger than the inline budget. The generic spill policy only sees the final tool result, so it cannot recover matches that a search tool already omitted. Search therefore needs tool-owned retention and best-effort formatted-result spill.

## Decision

`glob` and `grep` are conditional model-facing tools in `@deepseek-ai/dsh-tool-fs-search`, backed by the bash seam, not by new `ctx.fs` provider methods. At plugin load, the package checks `command -v rg >/dev/null 2>&1` through `ctx.bash.resolve(request)` followed by `ctx.bash.run(spec)`; if the command exits nonzero, the package logs a warning and registers neither tools nor prompt sections. A probe that cannot start, times out, aborts, is killed, or produces no exit code fails plugin load loudly because that is a broken bash executor rather than an absent optional binary. When registered, execution uses the same `ctx.bash.resolve(request)` followed by `ctx.bash.run(spec)` flow with fixed `rg` command templates assembled by the tool. The tool layer owns schemas, argument validation, shell quoting, result parsing, result formatting, retention, formatted-result spill handoff, and timeout declaration. The bash executor owns request defaulting/capping, subprocess execution, process-group termination, environment scrubbing, raw output capture, and backend substitution across local, sandboxed, or remote bash implementations.

The tools do not use `ctx.bash.start()` and do not create model-visible background tasks. They run as ordinary foreground tools from the agent loop's perspective: the tool call returns only after the `rg` command exits, times out, is aborted, or fails. `defineTool({ timeoutMs })` declares the cooperative tool-call budget, `@deepseek-ai/dsh-timeout-policy` enforces it through `exec.signal`, and the tool forwards that signal into the bash request before `resolve()` / `run()`. The bash backend's own timeout remains a second safety cap; whichever aborts first wins.

The tools align `path` with Claude Code's search tools while binding resolution to the bash workdir, not to `ctx.fs`. The tool derives the bash request workdir from `exec.agent?.session.header.cwd`, mirroring `dsh-tool-bash` and `dsh-tool-fs`; when no session cwd exists, it omits `request.workdir` so the bash implementation applies its configured cwd or process cwd through `resolve()`. For `grep`, `path` is an optional ripgrep target and may be a file or directory; omitted means the resolved bash workdir. For `glob`, `path` is an optional directory search root; omitted means the resolved bash workdir. Relative `path` values resolve against that workdir. Returned paths are displayed relative to the resolved bash workdir when possible and are intended to be follow-up-readable only in co-located deployments where the bash workdir and filesystem `read` root are the same workspace. v1 documents that deployment requirement but does not perform runtime cross-service validation. Remote or virtual filesystem search is deferred until there is a shared workspace/root contract or a provider-specific search backend.

The package does not inject `fs`. It injects `tools`, `systemPrompt`, and `bash`; it deliberately reads `spillStore` with `ctx.get('spillStore')` instead of static inject because formatted-result spill is optional. Existing `@deepseek-ai/dsh-tool-fs` deployments that only want `read` / `write` / `edit` do not need to load bash. Deployments that load search need `rg` available in the bash executor environment for the tools to enter the model-visible schema.

### Package shape

The v1 package stays small. Inside `@deepseek-ai/dsh-tool-fs-search`, the source layout is:

```text
src/index.ts
src/glob.ts
src/grep.ts
src/search-core.ts
src/shell-quote.ts
```

`glob.ts` and `grep.ts` own their parameter validation, command construction, result parsing, formatting, and registration. `shell-quote.ts` is one shared helper because shell quoting is the safety boundary both tools must use; `search-core.ts` is the other (an implementation-time amendment to the original four-file plan): the `SEARCH_*` error vocabulary, the bash-run + raw-output acquisition, the formatted-spill handoff, and workdir-relative display are byte-identical between the two tools, and duplicating that delicate plumbing per tool is exactly the missed extraction the symmetry convention flags. Command builders must not hand-roll quoting or concatenate unquoted model-controlled values into the shell command.

### Schemas and config

`glob` exposes the small discovery shape:

```ts
interface GlobArgs {
  pattern: string
  path?: string
}
```

`grep` exposes the OpenCode-style minimal shape:

```ts
interface GrepArgs {
  pattern: string
  path?: string
  include?: string
}
```

Routine budgets stay out of the model-facing schema. `@deepseek-ai/dsh-tool-fs-search` owns these defaulted, validated config fields:

| Field | Default | Role |
|---|---:|---|
| `globMaxResults` | `100` | Max paths retained inline; matches Claude Code's default `GlobTool` result limit. |
| `grepMaxMatches` | `250` | Max flat matches retained inline; matches Claude Code's default `GrepTool` `head_limit`. |
| `grepMaxLineBytes` | `2000` | Max bytes retained for one matched-line preview, applied with `TextRetainer({ kind: 'head', maxBytes: grepMaxLineBytes })`. |
| `rawOutputMaxBytes` | `20000000` | Max complete raw `rg` stdout the tool will parse; matches Claude Code's ripgrep raw buffer. |
| `timeoutMs` | `30000` | Tool-call timeout attached to both tool definitions and enforced by `@deepseek-ai/dsh-timeout-policy`. |

`globMaxResults` and `grepMaxMatches` use `ItemRetainer({ kind: 'head' })`. `grepMaxLineBytes` uses `TextRetainer({ kind: 'head', maxBytes: grepMaxLineBytes })` for each matched line so preview cuts preserve UTF-8 boundaries. This follows the [tool result retention library](../architecture/2026-07-06-tool-result-retention-library.md) mapping for discovery items: collect the complete result, retain head items inline, and keep path mapping, grouping, and per-line preview outside the retainer. `grep` does not expose `case_insensitive`, `head_limit`, `offset`, `count`, multiline, context lines, output modes, or file type filters in v1. A model that needs surrounding context reads the matched file with `read`; a model that needs later results follows the returned spill locator's retrieval hint.

The Claude Code values are reference points for the two-layer budget, not model-facing schema precedent. Its dedicated search tools buffer raw ripgrep output up to 20 MB for internal processing, use a 20-second ripgrep timeout on non-WSL platforms (60 seconds on WSL), then apply search-specific caps before the model sees a result: `GrepTool` defaults to `head_limit = 250` and persists formatted results above 20,000 characters, while `GlobTool` defaults to 100 paths and persists formatted results above 100,000 characters. This Agent Note mirrors the raw-buffer and inline-count defaults, chooses a 30-second default search timeout, and uses this harness's `ctx.spillStore.saveText()` path for formatted-result recovery.

The `path` field follows the same split as Claude Code: `grep.path` is a file-or-directory ripgrep target, while `glob.path` is a directory search root. v1 does not expose a separate cwd/workdir argument on these tools.

`include` is one positive glob filter, not a list and not an exclude syntax. Reject comma-separated or negated include patterns up front with a structured argument error. Every model-controlled value used in a shell command, including `pattern`, `path`, and `include`, must pass through the package-private shell quoting helper.

### Execution

`glob` builds a fixed `rg --files` command rooted at the resolved directory search root (`path` when supplied, else the bash workdir): `rg --files --glob <pattern> --sort=modified --no-ignore --hidden`, plus VCS metadata excludes for `.git`, `.svn`, `.hg`, `.bzr`, `.jj`, and `.sl`. This aligns with Claude Code on hidden/ignored-file discovery and modified-time ordering while keeping VCS internals out of broad searches. The tool parses one path per line, maps results back to paths relative to the bash workdir when possible, pushes each path into `ItemRetainer({ kind: 'head', maxItems: globMaxResults })`, and formats the full sorted path list for a spill artifact when the retained result is capped.

`grep` builds a fixed line-oriented `rg --json` command against the supplied file/directory target (`path` when supplied, else the bash workdir) so file path, line number, and line text are parsed without colon-splitting ambiguity. It consumes `match` records, treats malformed JSON or malformed match records as `SEARCH_FAILED`, maps result paths relative to the bash workdir when possible, applies per-line preview retention with `grepMaxLineBytes`, pushes each match into `ItemRetainer({ kind: 'head', maxItems: grepMaxMatches })`, then groups only the retained preview matches by file for inline output. The spill artifact stores the full formatted match list, not only the omitted tail, so the retrieval hint points at the same logical result the model saw.

Raw `rg` stdout is an internal transport detail. The tool requests `stdoutMaxBytes: rawOutputMaxBytes` through `ctx.bash.resolve()` and parses `stdout.text` only when the executor returns untruncated stdout within that cap. If stdout is larger than `rawOutputMaxBytes`, or the executor still returns `stdout.truncated`, the tool fails with a clear search error telling the model to narrow `pattern`, `path`, or `include`. The tool never exposes raw `rg` output or bash raw spill paths to the model.

Only stdout is a parse source. Stderr is diagnostic text for invalid patterns, runtime `rg` disappearance after registration, and search failures; if bash truncates stderr, the tool uses the retained stderr tail with a truncation note and does not read `stderr.spillPath`.

If `ctx.bash.run()` reports `aborted` because the tool timeout or caller cancellation fired, the tool returns a structured failure rather than pretending there were no matches. If bash reports its own timeout first, the tool likewise fails with a clear timeout message. Nonzero ripgrep exit semantics are tool-owned: exit 0 is success with matches, exit 1 is success with no matches, invalid pattern / runtime `rg` disappearance / inaccessible search workdir are failures.

Search failures use a package-owned `HarnessError` subclass with `SEARCH_*` codes, not `FsErrorCode`, because these tools are not `ctx.fs` provider operations. The v1 vocabulary is `SEARCH_INVALID_PATTERN`, `SEARCH_FAILED`, `SEARCH_RAW_OUTPUT_OVERFLOW`, and `SEARCH_ABORTED`. Model argument validation failures such as missing required fields, blank strings, or unsupported negated/list `include` values remain ordinary tool argument errors.

### Formatted result spill

`ctx.spillStore` is optional and used only for model-facing formatted results. This is the first tool-owned spill call pattern in the codebase, and it is intentional because search retention is item-level policy: `globMaxResults` caps paths and `grepMaxMatches` caps matches while the tool still holds the complete logical result. The generic `dsh-spill-policy` caps final text bytes on `tools/post-execute`; by then a search tool would already have omitted later paths or matches, so the policy cannot recover them.

When a search produces more logical results than the inline cap and `ctx.spillStore` is present, the tool saves the complete formatted result with `saveText()`. The spill owner is the calling agent's session header id (`exec.agent?.session.header.id`); without that owner, the search keeps the inline result and reports that the complete result could not be saved. The spill source is the tool execution identity: `{ toolName: exec.name, callId: exec.callId, label: 'result' }`. The suggested filenames are `grep-results.txt` and `glob-results.txt`; the spill backend still treats them as hints, never paths.

When spill storage is absent, the call has no session owner, or saving fails, the tool still returns the inline page and a footer explaining that the complete result could not be saved. Search success must not turn into an `isError` result solely because formatted-result spill storage is unavailable.

The bash raw output stream and the formatted search spill artifact are different artifacts. Raw `rg` stdout is parsed only in memory within the requested bash stdout cap; the formatted spill artifact is the stable model-facing recovery locator produced by `ctx.spillStore.saveText()`.

### Result shape

A capped `glob` result with successful formatted spill returns the inline page and a spill notice:

```text
<first N paths>

(Showing N of M paths. Full sorted result stored at: /.../session-abc123/9f8e7d-glob-results.txt. Use read with offset/limit, or grep this path to search within it.)
```

A capped `grep` result with successful formatted spill returns grouped preview matches and a spill notice:

```text
Found N of M matches

<file>
Line 12: ...

(Full grep result stored at: /.../session-abc123/9f8e7d-grep-results.txt. Use read with offset/limit, or grep this path to search within it.)
```

If the complete logical result fits under the inline cap, no formatted spill artifact is created. If the complete logical result is too large but formatted spill is unavailable, the footer says that the result was capped and the complete result could not be saved. The `truncated` / omitted count is a budget fact, not an incomplete-search fact; timeout, invalid regex, runtime `rg` disappearance, inaccessible workdirs, raw-output overflow, binary skips, and parse failures stay in tool-domain error or incomplete fields.

## Alternatives considered

**Put `glob` / `grep` on `ctx.fs`.** Rejected for v1: it forces every filesystem backend to grow a search API and makes local ripgrep behavior part of the provider seam. Search is useful product behavior, but it is not a universal text-storage primitive like `readText` or `writeText`.

**Directly spawn ripgrep from `dsh-fs-local`.** Rejected for this Agent Note's v1: direct spawn gives the cleanest argv boundary, stdout/stderr control, and early-stop control, but it duplicates process execution concerns that the bash seam already owns: environment scrubbing, process-group kill, timeout propagation, sandbox/remote executor substitution, and bounded output capture. It remains a reasonable optimization if bash-backed search proves too shell-string-sensitive or if foreground streaming becomes necessary.

**Use `ctx.bash.start()` for streaming early stop.** Rejected: `start()` creates model-visible background task semantics: task ids, owner tokens, `bash_output`, `bash_kill`, completion notifications, and no built-in timeout. `grep` needs a foreground tool result, not a background bash workflow. If streaming search becomes necessary, the right abstraction is a foreground streaming process handle on the bash/process seam, not borrowing the public background-task API.

**Expose bash raw spill paths to the model.** Rejected: a bash raw spill path contains raw `rg` stdout (`rg --json` records for grep), not the stable formatted search result. Search parses raw stdout only as an internal transport; model recovery uses a formatted result saved through `ctx.spillStore.saveText()`.

**Add `spillStore.saveFile()` for bash output normalization first.** Rejected for this Agent Note's v1: `saveFile()` would help a future bash normalization pass move existing executor spill files into session-scoped spill storage, but search only needs bounded in-memory raw `rg` stdout before producing the model-facing artifact. `saveText()` is sufficient for the formatted search result.

**Rely on the generic `dsh-spill-policy`.** Rejected: generic post-execute spill sees only the final tool result. If `grep` / `glob` return the first page inline, the generic policy cannot recover omitted results. The search tools must save the complete formatted result themselves before returning the bounded model-facing text.

**Expose Claude Code's full `GrepTool` schema.** Rejected for v1: `output_mode`, context flags, multiline, `head_limit`, `offset`, `case_insensitive`, and type filters make the model-facing surface into a ripgrep wrapper. This harness keeps routine budgets and continuation mechanics in deployment policy and spill artifacts.

**Keep early-stop search and skip formatted spill artifacts.** Rejected for this proposal: early stop is more efficient but gives the model no path to inspect later results. The chosen v1 optimizes result recoverability and implementation simplicity, with `timeoutMs`, `rawOutputMaxBytes`, bash backend caps, and formatted spill artifacts as safety backstops.

**Expand the bash seam with a raw-output reader first.** Rejected: a portable `readRawOutput(ref, maxBytes)` API would add reference lifetime, permission, and backend storage semantics. A per-run `stdoutMaxBytes` request is the narrower seam: search either receives complete stdout within `rawOutputMaxBytes` or fails clearly.

**Always register and report missing `rg` only at execution time.** Rejected: a model-visible tool schema is a promise that the deployment can attempt that capability. If the bash executor cannot find ripgrep at load, the safer surface is no `glob` / `grep` tools or prompt guidance. Execution-time missing-`rg` classification remains as a defensive fallback for environments that change after registration.

## Testing

- Tests cover registration-time `rg` probing (probe success registers both tools and prompt sections, nonzero probe skips both tools and prompt sections with a warning, infrastructure probe failures reject plugin load), prove an aborted `exec.signal` reaches the bash backend (same-reference spec assertion plus the `SEARCH_ABORTED` result), and cover command construction/quoting (malicious patterns, paths with spaces, leading-dash values, quotes, newlines, glob metacharacters — unit assertions plus a real `bash -c` round-trip for every hostile value), `grep.path` as file and directory targets, `glob.path` as a directory search root, invalid pattern handling, no matches, malformed `rg --json` output, matched-line preview truncation, raw-output overflow, timeout/abort, formatted spill success/failure, the package-owned `SEARCH_*` error codes, and the no-background-task invariant.
- The first-party tool-owned spill precedent is covered directly: spill backend present, spill backend absent, `saveText()` failure, and missing spill owner.
- The package has real Loader-path coverage for the namespace plugin export shape (`name`, `inject`, `Config`, and `apply`, with no default export).
- A real-executor integration suite (`dsh-bash-local` + a real `rg`) verifies the world: hostile patterns stay inert, per-session cwd resolution, VCS-metadata exclusion, modification-time ordering, and real ripgrep stderr classification. It self-skips where `rg` is not on the test process PATH (a CI accommodation mirroring the keyless e2e skip); the fake-executor suite carries registration and execution coverage for missing `rg`, plus the per-file 100% coverage gate.
- Snapshot gap note for the transcript-visible spill notice: this landed with the gap note, not a snapshot. The snapshot tier replays the acp-agent tree, and adding the search plugin there changes the assembled system prompt — every expected output would need re-recording with a real key, which the implementing environment did not hold. The spill notice's exact transcript text is pinned by unit tests (`formatGlobOutput`/`formatGrepOutput` and the through-the-registry spill tests); wiring the plugin into the acp-agent tree plus a `test:snapshot:record` pass is the follow-up for the next key-holding session.

## Consequences

- `glob` and `grep` are conditional model-facing tools in `@deepseek-ai/dsh-tool-fs-search`, not `ctx.fs` provider methods and not part of the existing `@deepseek-ai/dsh-tool-fs` root plugin. They register only when the bash executor can find `rg`; the package injects `tools`, `systemPrompt`, and `bash`, does not inject `fs`, and keeps `ctx.spillStore` optional via `ctx.get('spillStore')`.
- The schemas are exactly `glob(pattern, path?)` and `grep(pattern, path?, include?)`; search caps and timeout are defaulted, validated Config fields (`globMaxResults`, `grepMaxMatches`, `grepMaxLineBytes`, `rawOutputMaxBytes`, `timeoutMs`).
- The tools execute through `ctx.bash.resolve(request)` → `ctx.bash.run(spec)`, forward `exec.signal`, never call `ctx.bash.start()`, and never expose a bash task id. The bash request workdir comes from `exec.agent?.session.header.cwd` when available; the resolved `spec.workdir` drives execution and relative-path display.
- The tools request `stdoutMaxBytes: rawOutputMaxBytes` from the bash seam, parse only untruncated stdout within that cap, and treat over-cap or still-truncated raw output as a clear search failure; raw `rg` output is never exposed to the model.
- Oversized complete formatted results are saved through `ctx.spillStore.saveText()` when available while inline results stay bounded; spill failure, a missing backend, or a missing owner preserves the inline result and reports the unsaved remainder — never an `isError`.
- The package README, the generated config catalog, and exported JSDoc document the Config fields and `SEARCH_*` codes; the tui-agent example ships the conditional tool plugin (the acp-agent tree waits on the snapshot re-record above); the fs group README records the `rg` availability and co-located bash/filesystem deployment requirements.

## Risks

Full-run `grep` can be slower than an early-stop search on broad patterns. The v1 accepts that cost for simpler implementation and complete-result recovery, bounded by tool timeout, bash timeout, `rawOutputMaxBytes`, and output caps. If this proves too slow, the direct-ripgrep or foreground-streaming alternatives remain available.

Shell command construction is the sharpest safety edge. Because `ctx.bash` accepts a command string rather than an argv vector, the implementation must centralize shell quoting and test malicious patterns, paths with spaces, leading-dash patterns, quotes, newlines, and glob metacharacters.

The v1 assumes a co-located bash/filesystem deployment. If bash searches one workspace and the `read` tool resolves paths against another, returned paths may not be follow-up-readable. The package documents this requirement but does not verify it at runtime.

Spill locators are backend-owned. The current local backend returns local filesystem paths and works in deployments where `read`/`grep` can open those files; remote or workspace-confined deployments can use a backend whose locator and retrieval hint point at a supported retrieval mechanism.
