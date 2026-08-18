# e2b/ — E2B remote runtime family

English | [中文](README.zh.md)

An experimental provider-composition POC that places one filesystem/process execution world in an E2B Linux sandbox. E2B supplies only sandbox lifecycle and the two fundamental OS adapters; provider-neutral consumers build higher capabilities above them.

| Package | ctx key | Role |
|---|---|---|
| [`e2b`](e2b/README.md) (`@deepseek-ai/dsh-e2b`) | `ctx.e2b` | Create one sandbox, prepare its working/runtime directories, expose the shared SDK handle, and delete it on timeout or disposal |
| [`fs-e2b`](fs-e2b/README.md) (`@deepseek-ai/dsh-fs-e2b`) | `ctx.fs` | Implement the filesystem seam over E2B Filesystem APIs |
| [`subprocess-e2b`](subprocess-e2b/README.md) (`@deepseek-ai/dsh-subprocess-e2b`) | `ctx.subprocess` | Implement executable lookup, managed process groups and stdio, remote spill files, and terminal sessions over E2B Commands and PTY APIs |

The existing [`dsh-bash-local`](../shell/bash-local/README.md), [`dsh-terminal-bash`](../terminal/terminal-bash/README.md), and [`dsh-lsp-stdio`](../lsp/lsp-stdio/README.md) need no E2B-specific forks. They delegate every execution-world operation to `ctx.fs` and `ctx.subprocess`, so mounting the two E2B adapters places their mutable work in the same sandbox.

This boundary does not move the harness process, Cordis objects, model calls, agent/session state, session persistence, skills, higher-level protocol state, or E2B SDK buffers. The [portable execution-world decision](../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.md) owns both the generic composition and this POC boundary.
