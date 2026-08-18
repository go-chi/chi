# @deepseek-ai/dsh-bash-sandbox

English | [中文](README.zh.md)

Sandbox-consuming Service Provider for the [`@deepseek-ai/dsh-shell`](../shell/) executor seam. Load it **instead of** `@deepseek-ai/dsh-bash-local`, together with a [`ctx.sandbox`](../../sandbox/sandbox/) provider (e.g. [`@deepseek-ai/dsh-sandbox-local`](../../sandbox/sandbox-local/)) and a [`ctx.sandboxPolicy`](../../sandbox/sandbox-policy/) (which owns the default mode + workspace root, shared with the sandboxed filesystem) — no alternate tool plugin is needed; `dsh-tool-bash` detects the executor's `sandboxMode` capability and adds the escalation fields.

The package root exports the default and named `SandboxBashExecutor` plugin plus its `Config`; result-classification helpers stay internal.

Every command is confined by handing the provider the exact `['bash', '-c', command]` argv this executor is about to spawn and spawning the returned argv directly. With the shipped native runners, the inner Bash retains shell semantics and evaluates `BASH_ENV` only after the runner establishes confinement. WHICH platform runner confines it — and whether one is usable at all (fail closed with a structured `SANDBOX_UNAVAILABLE` error, never a silent unconfined run) — is the provider's concern; this package owns the bash side only.

| Mode | File effects |
|---|---|
| `read-only` (default) | No writes anywhere (of `/dev`, only the `/dev/null` node is writable, so `>/dev/null` keeps working) |
| `workspace-write` | Writes only under `workspaceRoot` + `/tmp` (ephemeral under bwrap, the host `/tmp` under Landlock, `/private/tmp` plus the per-user temp dir under Seatbelt) |
| `danger-full-access` | No confinement; the provider is never consulted. Foreground results carry `sandbox: { mode, denied: false }`; background process handles carry no sandbox facts. |

Semantics:

- **Denials are result facts.** A failed run whose stderr carries the selected backend's own denial dialect — the signatures the provider stamps on every wrap (EROFS text under bwrap, EACCES under Landlock, EPERM under Seatbelt) — is reported as `ShellRunResult.sandbox.denied: true` (conservative classification, read from the collected stderr tail); every CONFINED run also carries the mode it executed under (`result.sandbox.mode`) and the provider's enforcement completeness (`result.sandbox.enforcement`: `full`, or `partial` on an older Landlock ABI).
- **The runner path or syscall must match.** Before a process starts, a rejection is attributed to the runner only when the caller-owned workdir is independently usable and Node reports `ENOENT` or `EACCES` with either an `error.path` equal to provider argv[0] or, when `error.path` is absent, an exact `syscall: 'spawn <runner>'`. A present path also requires `syscall: 'spawn'` or the exact `spawn <runner>`. This covers a missing runner, a non-executable runner, or an executable script whose shebang interpreter is unavailable. A bare `syscall: 'spawn'` without an exact error path, any other code, an invalid or unusable workdir, a resource failure, an unrelated syscall, or an unstructured rejection retains the local executor's command-start failure semantics. Foreground execution throws `SANDBOX_UNAVAILABLE` with the original spawn detail, while asynchronous background settlement stamps `runnerFailed: true` and `denied: false`. If a `SubprocessRuntime` synchronously throws the same runner-identifying `ENOENT`/`EACCES` shape, background start throws `SANDBOX_UNAVAILABLE`; other synchronous errors propagate unchanged. After a process starts, a rule's optional exit-code check and a remaining fatal stderr line must both match after exact informational-line exclusions. A match takes priority over denial; foreground execution throws `SANDBOX_UNAVAILABLE` with the matched fatal line, while a settled background process stamps `process.sandbox.runnerFailed`, which the bash producer renders through generic `job_output`. Confined background handles retain their mode/enforcement facts and release per-process accounting in either path.
- **Deployment fallback, per-call policy.** [`ctx.sandboxPolicy`](../../sandbox/sandbox-policy/) resolves a complete `SandboxExecutionPolicy` for every tool call: the calling session supplies its mode override and immutable cwd root, while deployment config supplies the fallbacks for agentless calls. An approved escalation changes only that policy's mode; its session root stays attached. `resolve()` carries the policy onto the spec, so overlapping commands from different projects run, classify, and report under their own roots and modes. The capability fact `ctx.shell.sandboxMode` reports the configured default so the tool layer advertises escalation only when this executor is mounted; the static bash tool description separately owns denial and escalation guidance.
- **File effects only.** Network and process visibility are deliberately not restricted — the mode vocabulary does not pretend to cover what the backend does not enforce.
- Process mechanics (spawn, process-group kills, output collection/spill, background handles, credential scrub) are inherited from [`dsh-bash-local`](../bash-local/); runner selection lives in [`dsh-sandbox-local`](../../sandbox/sandbox-local/).

Deny-only at the seam: a denial is a reported fact, and this executor never negotiates permissions itself — the approval question lives in the tool layer (`dsh-tool-bash`), which drives the override this package honors.

```yaml
- id: sandbox
  name: '@deepseek-ai/dsh-sandbox-local'
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: read-only
    workspaceRoot: !!js process.cwd() # fallback for calls without a session cwd
- id: bash
  name: '@deepseek-ai/dsh-bash-sandbox'
```

## Model Experience

### Bash tool schema, indirectly

#### What the model sees

The generated [`dsh-tool-bash` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash) are the baseline. By advertising a confining `sandboxMode`, this backend augments `bash` with `sandbox_permissions` using enum `workspace-write` | `danger-full-access` and with `justification`. The policy owner separately contributes the current capability-neutral `sandbox:policy` context.

#### Token effect

Small fixed schema increment on requests where `bash` is visible, plus the current-policy clause owned by `dsh-sandbox-policy`.

#### KV Cache effect

A standing-policy change appends a complete owner-rendered context snapshot after retained history, preserving the existing system/history prefix byte-for-byte. Changing executor capabilities alters the `bash` schema.

### Bash tool result, indirectly

#### What the model sees

After ordinary bounded output, a denied call appends exactly `[sandbox: file access denied under <mode> mode]`. When escalation is available it next appends `[sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]`. A settled background runner failure instead appends `[sandbox: the sandbox runner itself failed under <mode> mode — the command did not run; this is a sandbox problem, not a command failure]`.

#### Token effect

Zero additional tokens on an unremarkable allowed run beyond ordinary output. Denial or failure adds the quoted conditional marker, retained until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Bash tool error, indirectly

#### What the model sees

If no runner can enforce a confined mode, the foreground call propagates the [`SANDBOX_UNAVAILABLE` error owned by `dsh-sandbox`](../../sandbox/sandbox/README.md#confinement-error-indirectly). A runner-attributable spawn failure supplies the original spawn error as detail; a rejection without `ENOENT`/`EACCES` path or syscall evidence that names argv[0] remains an ordinary command-start error. A settled runner failure supplies the matched fatal stderr line and preserves the original stderr collection. When present, the appended `Runner failure: <detail>` is the authoritative diagnosis; the preceding backend-install text is the generic `SANDBOX_UNAVAILABLE` prefix.

#### Token effect

Conditional error text is visible for that call and retained in history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Confinement covers file effects only** — network access and process visibility are unchanged, so the modes are not a general-purpose security sandbox.
- **Denials are inferred from failed-command stderr** — backend signatures make the inference portable, but a matching application error can be classified as a denial and a denial omitted from the retained tail can be missed.
- **An asynchronously observed background runner failure has no immediate error channel** — it is recorded on the settled process and surfaces when the caller reads the generic task with `job_output`; a synchronous `SubprocessRuntime` throw that names the runner path instead fails `start()` immediately.
- **`danger-full-access` deliberately bypasses `ctx.sandbox`** — it is an explicit unconfined mode, not a wider sandbox profile.
