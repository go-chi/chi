# @deepseek-ai/dsh-tool-bash

English | [中文](README.zh.md)

The model-facing `bash` tool registered over the `ctx.shell` executor seam. Foreground execution stays behind that seam; a background process handle is registered with the generic `ctx.jobs` runtime and controlled through `job_output`, `job_list`, and `job_kill` from `@deepseek-ai/dsh-tool-jobs`.

Requires a loaded executor Service Provider (e.g. `@deepseek-ai/dsh-bash-local`) and the [`@deepseek-ai/dsh-shell-env`](../shell-env/README.md) registry; the plugin stays pending until every injected service exists (`inject: ['tools', 'bash', 'systemPrompt', 'bashEnv']`). The tool contract is bash-dialect — mount a bash-parsing executor.

The package root exposes only the Cordis plugin contract (`name`, `inject`, `Config`, `apply`); result rendering and background-process adaptation remain package-internal.

The plugin also contributes the `tool:bash` prompt section (order 105): check the `[exit code: N]` marker on every result and investigate failures before moving on.

## Tools

### `bash`

| Arg | Type | Notes |
|---|---|---|
| `command` | string (required) | Run via `bash -c`. No state persists between calls — use `workdir`, not `cd`. |
| `description` | string (required) | One-line, active-voice summary of the command (5-10 words), for UI/log display only — no effect on execution. |
| `timeoutMs` | number | Timeout override in milliseconds. The executor applies its configured default and cap. |
| `workdir` | string | Working directory for this call. Defaults to the filesystem identity of the calling agent's session cwd (`session.header.cwd`) so each session runs in its own workspace; a relative `workdir` is resolved against that same identity. |
| `run_in_background` | boolean | Return a job id immediately; no timeout applies. |
| `sandbox_permissions` | string enum | ADVERTISED ONLY when the mounted executor sandboxes (`ctx.shell.sandboxMode` reports a confining default): the wider mode a denied command needs, from the closed target vocabulary `workspace-write`/`danger-full-access` (never cut down to the executor's default — the effective mode is per-session; strict widening is checked at execution against it, and a non-widening request fails without prompting anyone). |
| `justification` | string | Required together with `sandbox_permissions` (each without the other is a validation error): one sentence for the user explaining why this exact command needs the wider access. |

`command`, `workdir`, and `timeoutMs` are resolved against the executor's config defaults via `ctx.shell.resolve()` before execution, so the Service Definition (`ShellExecSpec`) receives explicit `workdir`/`timeoutMs` values. The workdir default is applied in the tool layer from the calling agent's `session.header.cwd` BEFORE `resolve()` — the per-session cwd must come from `exec.agent`, since N sessions share one executor; only when no session cwd is available does the executor fall back to its own config / `process.cwd()`. When sandbox policy is present, the tool reuses its already-canonical `workspaceRoot` as the workdir base so confinement and process launch cannot resolve the same session spelling differently.

### Managed shell environment

Every foreground and background model bash call receives a freshly collected trusted `DSH_*` environment through the shared [`dsh-shell-env`](../shell-env/README.md) registry: `DSH_HOME` (the absolute Harness home), `DSH_SHELL=1`, the agent's `DSH_SESSION_ID`, and `DSH_SESSION_JSONL` when the active persistence backend locates one. The registry contract — contributor registration, loud duplicate/undeclared-key failure, the built-in reservations, and the contributor example — lives in that package's README. The snapshot passes through the dedicated `ShellExecRequest.dshEnv` channel; the local executor removes all inherited `DSH_*` before merging it, so nested harnesses and concurrent parent/child agents cannot leak stale identities, and `process.env` is never modified. The tool description teaches the generic `$DSH_*` convention rather than naming persistence-specific variables or adding a permanent system-prompt section.

Result text contains stdout, an optional `[stderr]` section, then applicable sandbox-denial, timeout, signal, exit-code, and truncation markers. Timeout is reported independently of final exit status; nonzero exit remains a model-interpreted result rather than `isError`. Truncation links a safe complete spill file or reports it unavailable. Only infrastructure failures such as spawn errors and aborts produce `isError`.

The canonical success is `{ kind: 'foreground', ...ShellRunResult }` for a completed foreground process or `{ kind: 'background', jobId }` for a published task. The Native renderer preserves the text above, including exactly `started background job <id>`; programmatic consumers use the typed fields without parsing those strings. Executor stream caps remain acquisition limits on `ShellRunResult` and carry their spill paths.

When `run_in_background` is true, this plugin preflights `ctx.jobs.start()` before spawning, registers the calling agent as owner, and adapts the returned `ShellProcess` handle into generic cancel/done/incremental-output hooks. The job runtime owns ids, cross-session isolation, completion notices, waiting, and disposal cleanup; this plugin only maps bash exit/sandbox facts into job output and outcome detail. `enableRunInBackground: false` removes the parameter and rejects a forced background call at execution time.

## UI presentation

The tool owns its `presentCall`/`presentResult` render intent. A foreground call is a terminal card carrying command, description, cwd, output, and parsed exit status. Because the card shows the exit as its own pill, the `[exit code: N]` / `[killed by signal: …]` marker the parse consumes leaves the output; every other marker (truncation, timeout, sandbox) stays in it. A background start is a generic execute card because it returns only a job id; the generic `job_*` tools own their own cards. These presenters are pure and replay-safe.

## The tool builds its request from named args only

`ShellExecRequest` carries optional `stdoutMaxBytes`, `stdin`, ordinary `env`, and managed `dshEnv`, used by trusted in-process plugins and this tool's environment registry. The model-facing tool exposes none of `stdoutMaxBytes`, `stdin`, or `env`: it builds requests from named command/workdir/timeout/signal/sandbox fields plus the registry-collected `dshEnv`. Extra model keys are ignored and cannot replace managed values. Shell syntax provides equivalent command-level behavior, while the local executor scrubs ambient credentials and stale `DSH_*` values. See the [stdin/env Agent Note](../../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md).

## Permissions and escalation

Commands run with the executor's full authority unless a sandboxing executor ([`dsh-bash-sandbox`](../bash-sandbox/)) confines them — the deny-only sandbox reports denials as result facts, rendered here as the denial marker; per-call allow/deny/ask policy is the `tools/pre-execute` waterfall (see docs/architecture.md).

Escalating bash calls resolve `ctx.approval` before execution. `allowed-once` applies the requested mode only to that call; rejection, cancellation, unavailability, or missing approval context executes nothing and returns a distinct error. On a real denial, the model may retry the same command once in the same turn with the narrowest sufficient mode and justification; the approval prompt itself is the consent step. Escalation is never speculative, and a disabled or rejected approval is final. The [sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) owns the rationale.

## Per-session mode switching

For sandboxing executors, each call resolves mode as one-shot escalation, then session override, then executor default. Non-sandboxing and agent-less calls carry no session override. The policy owner contributes the current capability-neutral standing mode; denial results still own the operation-specific effective mode and retry guidance. See the [`dsh-shell` fold](../shell/README.md) and [sandbox switching contract](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md).

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the bash guidance below. The policy owner contributes current sandbox state through its cache-safe runtime context rather than changing this section. Scoped tool restrictions can hide the schemas without removing this independently registered section.

##### Bash guidance

```markdown
Check the [exit code: N] marker on every bash result; investigate failures before moving on.
```

#### Token effect

Small fixed input cost per request while the plugin is active, unchanged by sandbox mode or mode switches.

#### KV Cache effect

Prefix-stable while the registration scope and prompt text are unchanged. Plugin activation or disposal may invalidate reuse from this prompt section; sandbox mode switches do not.

### Tool schemas

#### What the model sees

The model sees the generated [`bash` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash). `run_in_background` appears only when this producer enables it; `sandbox_permissions` and `justification` appear only when the mounted executor advertises sandboxing. Agent-scoped tool restrictions can remove the definition for that agent.

#### Token effect

Fixed schema cost on every request where the tools are visible; sandbox support adds the escalation fields and its conditional description paragraph.

#### KV Cache effect

Prefix-stable while visibility, background support, and executor sandbox capabilities are unchanged. A restriction, config change, or executor change may invalidate reuse from the first changed tool definition.

### Foreground result

#### What the model sees

The renderer emits the data-dependent stdout tail, then optional `[stderr]` and the stderr tail. With no output it emits exactly `(no output)`. Conditional lines are exactly `[output truncated; full output: <path-or-(unavailable)>]`, `[sandbox: file access denied under <mode> mode]`, `[timed out after <timeoutMs>ms]`, `[killed by signal: <signal>]`, and `[exit code: <exitCode>]`; the sandbox escalation and runner-failure lines are quoted in [`dsh-bash-sandbox`](../bash-sandbox/README.md).

#### Token effect

Zero result tokens before a call. Output is bounded per stream, while each emitted line remains in history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Background job context and results

#### What the model sees

Start returns exactly `started background job <jobId>`. This producer supplies incremental process output, optional `[some output was dropped from memory; full output: <paths-or-(unavailable)>]`, sandbox facts, and terminal detail such as `exit code: <exitCode>` or `signal: <signal>` to the generic job runtime. [`dsh-tool-jobs`](../../jobs/tool-jobs/README.md) owns the visible status line, completion notice, listing, and cancellation response.

#### Token effect

The start acknowledgement is small and retained; collected output is data-dependent and bounded by the executor's stream buffers. Consuming reads do not repeat prior output.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Tool errors

#### What the model sees

Validation and policy failures are normalized as `Error: <message>`. This package's stable messages are `invalid command: expected a non-empty string`, `invalid description: expected a non-empty string`, `invalid timeoutMs: expected a positive number, got <value>`, `invalid escalation: sandbox_permissions requires a justification`, `invalid escalation: justification is only valid together with sandbox_permissions`, `invalid justification: expected a non-empty sentence`, `background execution is disabled for this bash tool`, `background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs`, `sandbox_permissions is not available in this composition (no sandboxing executor to escalate)`, `sandbox escalation to "<mode>" is not strictly wider than this call's current "<mode>" mode`, the approval-availability/rejection/cancellation variants, and `tool call aborted`.

#### Token effect

Only the failing call adds these retained tokens; a rejected escalation does not add command output because the command does not run.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Replay exit pills parse from result text** — output whose final line happens to be exactly `[exit code: N]` / `[killed by signal: …]` shows a wrong pill on session replay and loses that line from the card body, because the parse treats it as the marker it consumes; a display-only known residual.
- **The `bash` tool opts out of `timeout-policy` budgets** — it keeps the executor-owned `BASH_TIMEOUT` path, per [the tool-call timeout-policy Agent Note](../../../.agents/notes/implemented/architecture/2026-07-07-tool-call-timeout-policy.md).
- **Background processes have no executor timeout** — callers must use `job_kill`, or rely on owner/service disposal, when work no longer matters.
