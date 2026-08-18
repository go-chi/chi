# @deepseek-ai/dsh-tool-pwsh

English | [中文](README.zh.md)

The model-facing `pwsh` tool registered over the `ctx.shell` executor seam. Intended for Windows compositions where a PowerShell executor (e.g. `@deepseek-ai/dsh-pwsh-local`) backs `ctx.shell`; the tool contract is PowerShell-dialect: native `C:\...` paths and `$env:NAME` variables. Behavior mirrors `dsh-tool-bash` call-for-call — foreground and `run_in_background` execution through the generic job runtime, the managed `DSH_*` environment through the shared `shell-env` registry, the sandbox denial rendering with the same-turn `sandbox_permissions` escalation surface, and the bash marker/truncation rendering story (a clean exit produces no marker).

Requires a loaded executor implementation and the `shell-env` plugin; the tool stays pending until both exist (`inject: ['tools', 'bash', 'systemPrompt', 'bashEnv']`).

The package root exposes only the Cordis plugin contract (`name`, `inject`, `Config`, `apply`); result rendering (`src/render.ts`) and background-job adaptation (`src/background.ts`) mirror the bash tool's structure and stay reachable through the package's `./src/*` export.

The plugin also contributes the `tool:pwsh` prompt section (order 105): non-zero exits are reported as `[exit code: N]` markers, and Windows interruption settles as exit 1 without a signal marker.

## Tools

### `pwsh`

| Arg | Type | Notes |
|---|---|---|
| `command` | string (required) | Run via `pwsh -Command`. No state persists between calls — use `workdir`, not `cd`. |
| `description` | string (required) | One-line, active-voice summary of the command (5-10 words), for UI/log display only — no effect on execution. |
| `timeoutMs` | number | Timeout override in milliseconds. The executor applies its configured default and cap. |
| `workdir` | string | Working directory for this call. Defaults to the calling agent's session cwd (`session.header.cwd`) so each session runs in its own workspace; a relative `workdir` is resolved against that same identity. |
| `run_in_background` | boolean | Return a job id immediately; no timeout applies. |
| `sandbox_permissions` | string enum | Advertised only when a sandboxing executor is mounted (`ctx.shell.sandboxMode` defined). The wider sandbox mode for a one-shot retry of a command the sandbox just denied — the narrowest wider mode that suffices, requiring `justification` and user approval through `ctx.approval` BEFORE execution. A non-widening or unapprovable request fails closed without running anything. |
| `justification` | string | Required with `sandbox_permissions`: one sentence for the user explaining why this exact command needs the wider access. |

`command`, `workdir`, and `timeoutMs` are resolved against the executor's config defaults via `ctx.shell.resolve()` before execution. The workdir default is applied in the tool layer from the calling agent's `session.header.cwd` BEFORE `resolve()` — the per-session cwd must come from `exec.agent`, since N sessions share one executor; only when no session cwd is available does the executor fall back to its own config / `process.cwd()`.

### Managed shell environment

Every foreground and background model pwsh call receives a freshly collected trusted `DSH_*` environment through the shared [`dsh-shell-env`](../shell-env/) registry: `DSH_HOME` (the absolute Harness home), `DSH_SHELL=1`, the agent's `DSH_SESSION_ID`, and `DSH_SESSION_JSONL` when the active persistence backend locates one. Plugins contributing `DSH_*` facts to `ctx.shellEnv` apply to pwsh calls exactly as they do to bash calls. The snapshot passes through the dedicated `ShellExecRequest.dshEnv` channel; `process.env` is never modified. The description teaches the generic `$env:DSH_*` convention rather than naming persistence-specific variables.

Result text contains stdout, an optional `[stderr]` section, then applicable truncation, sandbox-denial (with the same-turn escalation hint when the composition advertises escalation), timeout, signal, and exit markers. A clean exit (0, no signal) produces no marker; an empty body renders as `(no output)`. Truncation links a safe complete spill file or reports it unavailable. Timeout is reported independently of final exit status; nonzero exit remains a model-interpreted result rather than `isError`. Windows reports forced termination as exit 1 without a signal, so `[killed by signal: …]` is POSIX-only there. Only infrastructure failures — spawn errors and aborts (`tool call aborted`) — produce `isError`.

The canonical success is `{ kind: 'foreground', ...ShellRunResult }` for a completed foreground process (with the executor's `sandbox` facts — `mode`/`denied`, optional `enforcement`/`runnerFailed` — projected when present) or `{ kind: 'background', jobId }` for a published task. The renderer preserves exactly `started background job <id>` for background acks; programmatic consumers use the typed fields without parsing the rendered text.

When `run_in_background` is true, this plugin preflights `ctx.jobs.start()` before spawning, registers the calling agent as owner, and adapts the returned `ShellProcess` handle into generic cancel/done/incremental-output hooks. The job runtime owns ids, cross-session isolation, completion notices, waiting, and disposal cleanup; this plugin only maps pwsh exit facts into job output and outcome detail. `enableRunInBackground: false` removes the parameter and rejects a forced background call at execution time.

## UI presentation

The tool owns its `presentCall`/`presentResult` render intent. A foreground call is a `terminal` card carrying command, description, and optional cwd; a `run_in_background` call is a `generic` card with the raw command, mirroring the bash tool's background presentation. A completed foreground result is a `terminal` card too: the exit marker becomes the card's exit-status pill (`exitCode`/`signal`), and the marker-free body is the card's output — exactly the bash tool's terminal-card story, via the shared exit-status parse from `@deepseek-ai/dsh-shell`. Background acks and execution errors stay `generic` cards with the rendered output in a `console` fence. These presenters are pure and replay-safe.

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the pwsh guidance below. Scoped tool restrictions can hide the schema without removing this independently registered section.

##### Pwsh guidance

```markdown
Non-zero exits are reported as `[exit code: N]` markers; investigate failures before moving on. On Windows a killed process settles as `[exit code: 1]` without a signal marker; treat a bare exit 1 after an interruption as a termination, not a command failure.
```

#### Token effect

Small fixed input cost per request while the plugin is active.

#### KV Cache effect

Prefix-stable while the registration scope and prompt text are unchanged. Plugin activation or disposal may invalidate reuse from this prompt section.

### Tool schemas

#### What the model sees

The model sees the generated [`pwsh` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-pwsh). Agent-scoped tool restrictions can remove the definition for that agent.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while visibility and the tool definition are unchanged. A restriction or config change may invalidate reuse from the first changed token.

### Foreground result

#### What the model sees

The renderer emits the data-dependent stdout tail, then optional `[stderr]` and the stderr tail. Conditional lines are exactly `[output truncated; full output: <path>]`, `[sandbox: file access denied under <mode> mode]` plus the escalation hint `[sandbox: escalation available — …]` (only when the composition advertises escalation), `[timed out after <timeoutMs>ms]`, `[killed by signal: <signal>]`, and `[exit code: <exitCode>]` (nonzero exits only); an empty body renders as `(no output)`.

#### Token effect

Zero result tokens before a call. Output is bounded per stream, while each emitted line remains in history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Background result

#### What the model sees

A background start renders exactly `started background job <id>`; subsequent reads and status flow through the generic `job_output`/`job_kill` tools, including the lossy-read spill notice when in-memory truncation dropped unread bytes.

#### Token effect

The ack is a fixed short line; job output is bounded per read.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Tool errors

#### What the model sees

Validation and infrastructure failures are normalized as `Error: <message>`. This package's stable messages are `invalid command: expected a non-empty string`, `invalid description: expected a non-empty string`, `invalid timeoutMs: expected a positive number, got <value>`, `invalid escalation: sandbox_permissions requires a justification`, `invalid escalation: justification is only valid together with sandbox_permissions`, `invalid justification: expected a non-empty sentence`, `sandbox_permissions is not available in this composition (no sandboxing executor to escalate)`, the shared escalation failures (not strictly wider / no approval service / no agent to route / no approval channel / user rejected / was cancelled), `run_in_background is disabled for this deployment (enableRunInBackground: false)`, `background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs`, and `tool call aborted`.

#### Token effect

Only the failing call adds these retained tokens; an aborted call adds no command output.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Language mode and named-pipe capture under the Windows sandbox** — under the [Windows ACL sandbox](../../sandbox/sandbox-windows-acl/README.md), read-only pwsh starts in ConstrainedLanguage because its temp write denial makes PowerShell's AppLocker probe fail closed: `Add-Type`, non-core .NET statics (`[System.IO.*]::`, `[math]::`), COM objects, and reflection fail with "only core types" errors, and the mode cannot be lifted from inside. Workspace-write's private temp lets the probe complete, so it stays in FullLanguage unless host policy says otherwise. Both confined modes deny named-pipe opens, so a piped-stdio spawn inside a confined command fails with EPERM. The tool description teaches both contracts to the model; the backend README owns the full limitations.
- **No persistent shell or PTY** — every call starts a fresh `pwsh -Command`; the PTY backends are Linux/macOS-only today, and a Windows ConPTY persistent shell is roadmap work.
- **PowerShell-dialect contract** — the model must write PowerShell (native paths, `$env:` variables), not bash; there is no dialect translation.
- **Session-cwd identity is not canonicalized** — the workdir base is the session header cwd as-is, unlike the bash tool's sandbox-root-canonicalized identity. Under a confining executor the policy's workspace root IS canonicalized (by the shared policy service), so the workdir and the confinement root can diverge when the raw session cwd differs from its canonical form — a parity gap deferred to the shared shell-tool base extraction.
