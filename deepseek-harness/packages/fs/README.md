# fs/ - filesystem capability family

English | [中文](README.zh.md)

The filesystem stack: a provider contract (execution-world paths, bounded text IO, and atomic mutation with an optional version guard), a local implementation, a policy gate plugin (observed-state + read-before-edit + version-guarded write/edit), the model-facing file tools + executor, and the ripgrep-backed discovery tools. All **product** packages.

| Package | Role | ctx key |
|---|---|---|
| `fs/` | Service Definition: canonical process paths/file URIs/containment, text IO, and atomic mutation primitives; owns the `fs/*` policy events | `ctx.fs` |
| `fs-local/` | Local-filesystem `FileSystem` implementation | (registers `ctx.fs`) |
| [`e2b/fs-e2b`](../e2b/fs-e2b/README.md) | E2B-backed `FileSystem` implementation sharing the remote runtime owned by `ctx.e2b` | (registers `ctx.fs`) |
| `fs-sandbox/` | Sandbox-enforcing `FileSystem`: extends `fs-local` and fences write/edit by the per-call mode + workspace root policy (read-only denies, workspace-write contains to the session workspace + temp roots), reads pass through | (registers `ctx.fs`) |
| `fs-observation-policy/` | Policy gate plugin: observed-state + read-before-edit + version-guarded write/edit, via the `fs/*` event gate | (no service — `fs/*` listeners) |
| `tool-fs/` | Model-facing `read`/`write`/`edit` tools AND the executor (reads via `ctx.fs`, owns read windowing, dispatches `fs/*`); preserves filesystem semantics for session-cwd-relative paths and advertises sandbox escalation fields when the mounted `ctx.fs` confines | (registers on `ctx.tools`) |
| `tool-fs-search/` | Model-facing `glob`/`grep` discovery tools backed by the packaged `@vscode/ripgrep` binary spawned through `ctx.subprocess`, NOT by `ctx.fs` provider methods | (registers on `ctx.tools`) |

The Service Definition lives at `fs/fs/`. A sandboxed, remote, or project-scoped filesystem backend can replace `fs-local` without touching the Service Definition, policy gate, or model-facing tool schemas: `fs-sandbox` provides an in-process path fence over the shared sandbox mode ([decision](../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md)), while `fs-e2b` places file state in the remote execution world shared with the E2B subprocess provider ([decision](../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.md)). The policy (`fs-observation-policy/`) is a plugin that participates only through the `fs/*` event gate, not a service the tool injects — so dropping it gracefully loses the policy and leaves the unconstrained bare provider rather than breaking the tool. A deployment that loads `tool-fs/` is expected to also load it. The mode fence and the read-before-edit gate are orthogonal and compose. Discovery (`tool-fs-search/`) deliberately does NOT extend the provider contract: search is a process-backed `rg` workflow (the packaged `@vscode/ripgrep` binary spawned through `ctx.subprocess`), so filesystem backends stay free of a universal search contract; its tools register unconditionally, and its results are follow-up-readable when the search workdir and the `read` root are the same workspace (the co-located deployment its README documents).

## No timeouts on file IO

`read`/`write`/`edit` take **no** `timeoutMs` and the provider contract arms no deadline: file IO here runs untimed because a deadline would kill work the OS will still finish — see [the filesystem subsystem page](../../docs/subsystems/filesystem.md). Cancellation still propagates through the tool-execution signal for best-effort abort at syscall boundaries.

The subsystem reference — targets, outcomes, guards, policy events, the error taxonomy, and why file IO takes no timeout — is [docs/subsystems/filesystem.md](../../docs/subsystems/filesystem.md); the sandbox fence in the [cross-family fs sandbox Agent Note](../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md).
