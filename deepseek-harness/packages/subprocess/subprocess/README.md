# @deepseek-ai/dsh-subprocess

English | [中文](README.zh.md)

The subprocess seam (`ctx.subprocess`) is the process half of one execution world. The abstract `SubprocessRuntime` exposes executable lookup, ordinary managed `spawn`, and one terminal-process primitive; its vocabulary covers raw/collected stdio, process and terminal handles, exit facts, tree/session cleanup, and the managed `DSH_*` environment namespace. The local implementation lives in [`dsh-subprocess-local`](../subprocess-local/README.md).

## Contract

- `spawn(spec)` returns immediately with a live handle; `done` resolves at process close with exit facts (`SubprocessOutcome` carries no output and no cause classification) and rejects only for spawn-level failures.
- Spawn working directories and executable paths belong to the provider's execution world. `resolveExecutable(command, env?, signal?)` verifies absolute commands or resolves bare names against that world's scrubbed PATH plus explicit overrides.
- The spec is fully explicit — argv, cwd, per-stream stdio dispositions, grace — because deployment-varying defaults belong to the caller's config, not to a hidden subprocess-service default (the `dsh-shell` request/spec split is the owning template). `argv` is never shell-interpreted; a consumer that wants a shell passes `['bash', '-c', command]` itself.
- Stdio is Node-shaped per stream: `'pipe'` hands the caller the raw stream for its own protocol framing (LSP JSON-RPC, ACP ndjson), `'inherit'` passes the parent descriptor through for diagnostics, and collect mode (`{ maxBytes, spill? }`) buffers a bounded tail with an optional full-stream spill file. Collect readers take whole-stream byte offsets and never consume, so independent readers cannot steal one another's deltas; a read whose offset slid out of the in-memory tail is `lossy` and points at the spill file when one exists. Collected output stays readable after settlement.
- Termination is tree-scoped on every platform (POSIX detached groups with direct-child fallback; Windows `taskkill /T`): `terminate()` — the only termination verb — escalates SIGTERM→grace→SIGKILL (idempotent, driven by the spec's abort signal too, a no-op once the tree is gone), and `waitForExit(signal?)` observes whole-tree liveness so a consumer-owned teardown ladder holds each tier on real quiescence — the manager reacts but never classifies why (callers own deadlines, teardown ladders, and cause classification).
- `spawnTerminal(spec)` is the only non-pipe primitive. Its handle owns a real PTY, UTF-8 text I/O, foreground-process-group inspection/signalling, and one awaited `terminate()` operation that reaches quiescence for every session member the provider can still observe and settles in-flight handle calls; providers document substrate-specific observability limits. The spec signal cancels allocation only; the published handle owns its lifetime. The output stream ends after queued output when the top-level process exits, and a live transport failure rejects `done`. These operations remain one substrate primitive because ordinary pipes cannot allocate a controlling terminal or clean terminal-session members; readiness, scrollback, and owner policy remain in the PTY consumer.
- `scrubbedParentEnv()` / `SENSITIVE_ENV_PATTERN` are the one shared scrub definition: ambient credential-shaped and `DSH_*` names are dropped, and explicit `env` merges after the scrub. The local ordinary and terminal spawns both apply it; SDK-managed transports that own their spawn may import it directly.
- Disposal of the service terminates all still-running managed processes and awaits their exit.

See the [subprocess subsystem page](../../../docs/subsystems/subprocess.md) and the [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-26-subprocess-seam.md).

## Model Experience

Indirectly, through Consumers (today the bash executor family behind `dsh-tool-bash`), which own all model-facing rendering of process output and lifecycle.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

- **SDK-managed spawns remain outside** — an SDK transport that owns its internal spawn cannot route that call through this service; it can still import `scrubbedParentEnv` so environment policy stays single-sourced.
- **Teardown ladders are consumer-owned** — the seam ships signalling verbs and the tree-liveness wait, not a canned quiesce sequence; each out-of-process consumer encodes its child's cooperation shape itself (the ACP backend's stdin-EOF-first ladder is the in-repo template).
