# @deepseek-ai/dsh-pwsh-local

English | [中文](README.zh.md)

Local PowerShell Service Provider for the `@deepseek-ai/dsh-shell` executor seam over the [`@deepseek-ai/dsh-subprocess`](../../subprocess/subprocess/README.md) service: `PwshLocalExecutor` spawns `pwsh -NoLogo -NoProfile -NonInteractive -Command <command>` per call as a managed process through `ctx.subprocess`, and owns everything PowerShell-shaped — executable resolution, command defaulting and caps, timeout/cancel classification, the model-friendly terminal environment, and the model-facing stdout/stderr merge for background reads. Group mechanics (bounded spill-backed output, credential scrub, kill escalation, disposal) are the subprocess service's.

The command string rides as ONE argv element to `-Command`: PowerShell itself parses the text, and no intermediate shell exists, so there is no shell-quoting layer to escape (the `bash -c` string domain has no equivalent here). Native Win32 paths (`C:\...`) pass through unchanged.

The package root exports the default and named `PwshLocalExecutor` plugin, its `Config`, the pure `resolvePwshPath`/`candidatePwshPaths` helpers, and the `ENV_OVERRIDES`/`ENCODING_PREAMBLE` constants the executor injects into every spawn.

## Config

```yaml
- id: bash
  name: '@deepseek-ai/dsh-pwsh-local'
  config:
    cwd: C:\path\to\workspace   # default: process.cwd()
    timeoutMs: 120000           # default foreground timeout
    maxTimeoutMs: 600000        # cap for per-call overrides
    maxOutputBytes: 64000       # per-stream in-memory cap; overflow spills to disk
    maxSpillBytes: 67108864     # per-stream full-output spill cap
    graceMs: 3000               # kill escalation and post-exit pipe-drain grace
    pwshPath: C:\Program Files\PowerShell\7\pwsh.exe  # explicit executable; else well-known locations, then PATH
```

## Behavior

The Windows counterpart of `dsh-bash-local`, deliberately mirroring its semantics call-for-call:

- **Spawn per call, no shell state** — every call is a fresh non-interactive `pwsh -Command` (deterministic; no profile files). The `-NoLogo -NoProfile -NonInteractive` flags disable startup banners, profile loading, and prompts that would garble tool output.
- **The composition entry is a layer, not the last word** — when a settings provider is composed, this executor registers the capability's [`bash` namespace](../shell/README.md) with the entry above as its base, so a user section in `settings.yaml` layers over it and the next command runs with the new budgets. The namespace is shared with the POSIX family because a host composes exactly one provider of `ctx.shell`; a document written on either platform keeps resolving on the other. Values the schema cannot judge (positive and finite, the `graceMs` timer bound) are refused at the write, leaving the running executor on its last good section.
- **UTF-8 output pinned** — every command runs with `[Console]::OutputEncoding` and `$OutputEncoding` set to UTF-8 first, so the Windows PowerShell 5.1 fallback (or any host whose console code page is not UTF-8) cannot garble non-ASCII output: the subprocess collector decodes bytes as UTF-8. Input encoding is left at the host default; pwsh 7 defaults to UTF-8 and is unaffected.
- **Executable resolution** — `resolvePwshPath` prefers an explicit `pwshPath`, then on Windows probes PowerShell 7's install location, every PATH entry (Microsoft Store installs; surrounding quotes stripped), and Windows PowerShell 5.1 as a legacy last resort, checking each candidate with an lstat probe that accepts a real file or a link-shaped reparse point (a Store app execution alias stat-fails against its target's ACL, but lstat sees the alias itself); elsewhere it falls back to a bare `pwsh` resolved through PATH. Resolution is a pure function of `(configured, env, platform)`; it runs at construction and again only when a stored `pwshPath` differs from the one the current executable was resolved from, so an unrelated settings change never re-probes the filesystem.
- **Configured budgets over managed groups** — `resolve()` fills `workdir`/`timeoutMs`/`stdoutMaxBytes` from config, and every spawn hands the service explicit byte caps, spill cap, and `graceMs`. The grace must be positive, finite, and no greater than [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md), so Node can represent it with one timer. Tree termination (taskkill on Windows, process-group signals on POSIX), the post-exit pipe-drain grace, tail-keep truncation, and bounded spill files are [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md) mechanics. A foreground `ShellExecRequest.stdoutMaxBytes` can raise stdout's capture budget for one trusted caller; stderr and background runs still use `maxOutputBytes`.
- **Timeout and cancel classification** — `run()` fuses its config-clamped timeout with the caller's signal through one deadline; only the executor's own timeout reports `timedOut`, an upstream cancel reports `aborted`, and a self-terminated command reports neither ([timeout-library Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)). Windows reports forced termination as exit 1 without a signal, so signal-stamped facts (`signal`, `killed` status) are POSIX-only there; the timeout/abort classification is platform-independent.
- **Model-friendly terminal env** — `NO_COLOR=1 PAGER=cat GIT_PAGER=cat` (no `TERM=dumb`: that is a POSIX concept; `NO_COLOR` is honored by modern PowerShell renderers) merged as ordinary env under the service's credential scrub and `DSH_*` channel rules; an explicit caller entry still wins.
- **Background processes** — `start()` returns a live `ShellProcess` handle immediately, no timeout applies, and the handle's `readOutput()` merges the service's offset-based stdout/stderr reads into one marked-section delta with a consuming cursor. A still-running process belongs to the subprocess service, so it survives executor reloads and dies (killed and joined) with the service's disposal. Everything task-shaped (ids, ownership, polling, notices) lives in the generic [`ctx.jobs` runtime](../../jobs/jobs/README.md), which the tool layer registers the handle with — this executor never sees a session or a registry.

## Model Experience

Indirectly, through `dsh-tool-pwsh`, which renders this executor's bounded stdout/stderr tails, background-process deltas (through the generic job runtime), spill-file paths, and infrastructure failures.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Unconfined by itself** — this executor always runs commands with the harness process's authority; deployments needing confinement compose a sandboxing bash executor or policy instead.
- **No persistent shell or PTY** — every call starts a fresh `pwsh -Command`.
- **The command string is PowerShell text** — the `-Command` domain has no shell-quoting layer, but a model-facing command is parsed by PowerShell itself, so PowerShell syntax errors are command failures, not launch failures.
- **A background spawn-failure note is single-delivery** — the subprocess service buffers no output for a process that never ran, so the executor injects `spawn failed: …` into exactly one `readOutput()` delta; a reader that discards that delta cannot recover it.
- **Windows termination reports no signal** — a force-killed process settles as exit 1 with `signal: null`, so signal-based status classification (POSIX `killed`) does not apply on Windows; `kill()`-initiated stops still stamp `killed` directly.
- **The encoding preamble precedes the command** — PowerShell requires `param(...)`, `#requires`, and `using namespace`/`using assembly` statements at the very top of a script, so a command whose first statement is one of those cannot run under the UTF-8 output preamble. Wrap a `param(...)` script in `& { … }` (a param block legally heads a script block); `using` statements and `#requires` have no in-command workaround (`#requires` is inert inside `-Command` regardless of position) — run such scripts from a file instead.
- **Non-ASCII stdin under Windows PowerShell 5.1 may be mis-decoded** — the preamble pins output encoding only; `[Console]::InputEncoding` stays at the host default because setting it under redirected stdin throws. pwsh 7 defaults to UTF-8 and is unaffected.

Scrub-heuristic and spill-retention caveats live with [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md), which owns those mechanics.
