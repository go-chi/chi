# @deepseek-ai/dsh-bash-local

English | [中文](README.zh.md)

Local Service Provider for the `@deepseek-ai/dsh-shell` executor seam over the [`@deepseek-ai/dsh-subprocess`](../../subprocess/subprocess/README.md) service: `LocalBashExecutor` spawns `bash -c <command>` per call as a managed process group through `ctx.subprocess`, and owns everything bash-shaped — command defaulting and caps, timeout/cancel classification, the model-friendly terminal environment, and the model-facing stdout/stderr merge for background reads. Group mechanics (bounded spill-backed output, credential scrub, kill escalation, disposal) are the subprocess service's.

The package root exports the default and named `LocalBashExecutor` plugin plus its `Config`.

## Config

```yaml
- id: bash
  name: '@deepseek-ai/dsh-bash-local'
  config:
    cwd: /path/to/workspace   # default: process.cwd()
    timeoutMs: 120000          # default foreground timeout
    maxTimeoutMs: 600000       # cap for per-call overrides
    maxOutputBytes: 64000      # per-stream in-memory cap; overflow spills to disk
    maxSpillBytes: 67108864    # per-stream full-output spill cap
    graceMs: 3000              # kill escalation and post-exit pipe-drain grace
```

## Behavior

- **Spawn per call, no shell state** — every call is a fresh non-login `bash -c` with no rc files.
- **The composition entry is a layer, not the last word** — when a settings provider is composed, this executor registers the capability's [`bash` namespace](../shell/README.md) with the entry above as its base, so a user section in `settings.yaml` layers over it and the next command runs with the new budgets. Values the schema cannot judge (positive and finite, the `graceMs` timer bound) are refused at the write, leaving the running executor on its last good section; without a provider, or after one detaches, the composition entry is what runs.
- **Configured budgets over managed groups** — `resolve()` fills `workdir`/`timeoutMs`/`stdoutMaxBytes` from config, and every spawn hands the service explicit byte caps, spill cap, and `graceMs`. The grace must be positive, finite, and no greater than [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md), so Node can represent it with one timer. Process-group kills, post-exit pipe draining, tail retention, and bounded spill files are [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md) mechanics. A foreground `ShellExecRequest.stdoutMaxBytes` can raise stdout's capture budget for one trusted caller; stderr and background runs still use `maxOutputBytes`.
- **Timeout and cancel classification** — `run()` fuses its config-clamped timeout with the caller's signal through one deadline; only the executor's own timeout reports `timedOut`, an upstream cancel reports `aborted`, and a self-signaled command reports neither ([timeout-library Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)).
- **Model-friendly terminal env** — `NO_COLOR=1 TERM=dumb PAGER=cat GIT_PAGER=cat` prevents pagers and ANSI color from garbling results. These values merge as ordinary env under the service's credential scrub and `DSH_*` channel rules; an explicit caller entry still wins. See the [stdin/env Agent Note](../../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md) and [managed environment Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-agent-session-identity-and-log-location.md).
- **Background processes** — `start()` returns a live `ShellProcess` handle immediately with no timeout, and `readOutput()` merges offset-based stdout/stderr reads into one consuming delta, placing stderr under a `[stderr]` marker when present. A running process belongs to the subprocess service, survives executor reloads, and is killed and joined on service disposal. Job ids, ownership, polling, and notices belong to the generic [`ctx.jobs` runtime](../../jobs/jobs/README.md), which the tool layer registers the handle with.

## Model Experience

Indirectly, through `dsh-tool-bash`, which renders this executor's bounded stdout/stderr tails, background-process deltas, spill-file paths, and infrastructure failures.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Unconfined by itself** — this executor always runs commands with the harness process's authority; deployments needing confinement compose [`dsh-bash-sandbox`](../bash-sandbox/README.md), while per-call allow/deny/ask policy belongs on `tools/pre-execute`.
- **No persistent shell or PTY** — every call starts a fresh non-login `bash -c`; cwd-only persistence and interactive terminal sessions remain deferred until a real workflow requires them.
- **POSIX-only** — the `bash` binary is hardcoded, and the underlying service's group semantics are POSIX; Windows is unsupported.
- **A background spawn-failure note is single-delivery** — the subprocess service buffers no output for a process that never ran, so the executor injects `spawn failed: …` into exactly one `readOutput()` delta; a reader that discards that delta cannot recover it.

Scrub-heuristic and spill-retention caveats live with [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md), which owns those mechanics.
