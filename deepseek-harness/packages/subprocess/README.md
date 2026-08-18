# subprocess/ — subprocess capability family

English | [中文](README.zh.md)

The shared process substrate for one execution world: executable lookup, fully-specified managed child-process trees with raw or collected stdio, and one deep terminal-process primitive that owns PTY allocation, foreground groups, and provider-observable session cleanup. Command defaulting, shell semantics, deadlines, protocol framing, readiness, and presentation stay with consumers — the [bash executors](../shell/README.md), [LSP host](../lsp/README.md), [PTY shell backend](../terminal/README.md), and [ACP subagent backend](../subagent/README.md). See the [subprocess seam Agent Note](../../.agents/notes/implemented/architecture/2026-07-26-subprocess-seam.md).

| Package | ctx key | Role |
|---|---|---|
| [`subprocess`](subprocess/README.md) (`@deepseek-ai/dsh-subprocess`) | `ctx.subprocess` | Service Definition: executable lookup, ordinary managed spawns, the terminal-process primitive, handle lifecycles, and shared environment/output vocabulary |
| [`subprocess-local`](subprocess-local/README.md) (`@deepseek-ai/dsh-subprocess-local`) | — | Local Service Provider: detached process trees, bounded collection/spill, `node-pty`, foreground/session inspection, tree signalling, and terminate-and-join disposal |

The service owns process lifetime across consumer reloads; consumers own what a process means (a bash command, a future non-shell runner) and every default that shapes one.

The subsystem reference — spawn specs, output readers, outcomes, the `DSH_*` environment — is [docs/subsystems/subprocess.md](../../docs/subsystems/subprocess.md); the seam decision in the [subprocess seam Agent Note](../../.agents/notes/implemented/architecture/2026-07-26-subprocess-seam.md).
