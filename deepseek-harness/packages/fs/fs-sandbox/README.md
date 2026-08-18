# dsh-fs-sandbox — the sandbox-enforcing filesystem backend

English | [中文](README.zh.md)

`SandboxedFileSystem` extends [`LocalFileSystem`](../fs-local/README.md) and registers as `ctx.fs`. It inherits every text-storage mechanic verbatim (resolve, stat, read/stream, list, the atomic write, the read-match-write edit critical section) and adds only a per-call MODE fence on `writeText`/`editText`. Reads always pass through — every mode permits reading.

Its plugin config is the local backend config unchanged: `cwd` remains the relative-path resolution default, and `diffBasisMaxBytes` bounds the optional overwrite contextual-diff basis.

Loading it INSTEAD OF `dsh-fs-local`, together with a [`ctx.sandboxPolicy`](../../sandbox/sandbox-policy/README.md), is the whole swap; the model-facing tools (`dsh-tool-fs`) are untouched. The tool layer resolves the calling session's mode and cwd into the SAME per-call policy bash receives, so the two families never confine to different roots.

## The fence

The per-call policy carries the effective mode (session override or escalation grant) together with the calling session's immutable cwd root, falling back to deployment policy only for calls without one:

- `read-only` — denies every mutation with the structured `FS_SANDBOX_DENIED`.
- `workspace-write` — allows a mutation only when the target canonicalizes under a writable root: the workspace root plus the platform temp areas (`/tmp`, `os.tmpdir()`), the SAME set the Seatbelt profile grants, derived from the one [`writableRoots`](../../sandbox/README.md) function so the fs fence and the bash runner cannot drift. Canonical spellings use a lexical fast path; an identity-based ancestor fallback recognizes alias-equivalent roots such as Windows long names and 8.3 names without treating unrelated prefixes as contained. The target is re-canonicalized immediately before delegating, so an ancestor symlink swapped since the tool resolved it is caught.
- `danger-full-access` — delegates unfenced.

## Threat model: a policy fence, not a kernel boundary

The fence is a check in TRUSTED code over a MODEL-CONTROLLED path — the operations are the seam's own (open, rename), only the target path is untrusted, so canonicalize-then-contain is the complete answer to this surface. This mirrors the `code-runtime` stance: containment, not a security boundary. Kernel-grade isolation of untrusted CODE stays `ctx.shell`'s job ([`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md)). The residual TOCTOU (an ancestor symlink swapped between the containment re-check and the syscall) is narrowed by re-canonicalizing immediately before the write and is accepted for this threat model; a kernel-tight boundary needs `openat2`-class primitives not worth their portability cost here.

A denial is a structured `FsError` (`FS_SANDBOX_DENIED`, carrying the effective mode) — no stderr text inference (unlike bash's kernel denials), because an in-process fence knows exactly what it refused. The model-facing `[sandbox: file access denied under <mode> mode]` marker and the one-approved-wider retry live in the tool layer (`dsh-tool-fs`), exactly as bash's do. See [the cross-family fs sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md).

## Model Experience

### Filesystem policy and refusals

#### What the model sees

The policy owner contributes capability-neutral `sandbox:policy` context. Indirectly, `dsh-tool-fs` renders this backend's `FS_SANDBOX_DENIED` refusals as the `[sandbox: file access denied under <mode> mode]` marker plus the same-turn escalation hint.

#### Token effect

The current-policy clause adds a small runtime-context message while this backend is mounted; a denial adds the bounded marker and escalation hint to conversation history.

#### KV Cache effect

A standing-policy change appends an owner-rendered superseding runtime-context snapshot after retained history; operation results remain append-only.

## Known Limitations and Deferred Work

- **A policy fence, not a kernel boundary** — the check is trusted code over a model-controlled path, so the residual resolve-to-syscall TOCTOU is narrowed (by the in-place re-canonicalization) but not eliminated; adversarial host processes are out of scope. Kernel-grade isolation of untrusted code stays `ctx.shell`'s.
- **Fence-vs-runner parity is derived from one owner** — the writable set comes from `writableRoots`, shared with the Seatbelt profile; a runner profile that defines its writable set elsewhere would drift.
- **Requires `ctx.sandboxPolicy`** — tools use it to resolve each session policy and the backend uses it for agentless-call fallbacks; the backend does not confine without it composed.
