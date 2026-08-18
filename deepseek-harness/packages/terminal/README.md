# terminal/ — persistent PTY capability family

English | [中文](README.zh.md)

`PTY` stands for **Pseudo-Terminal**（伪终端）. This capability provides persistent, owner-scoped terminal sessions for workflows that require state across tool calls or interactive stdin. PTY complements the one-shot bash and filesystem tools; it does not replace their stronger per-operation contracts.

| Package | Role | ctx key |
|---|---|---|
| [`pty`](terminal/README.md) (`@deepseek-ai/dsh-terminal`) | Backend registry, branded ids, exact-Agent ownership, session operations, and awaited cleanup | `ctx.terminals` |
| `terminal-bash` (`@deepseek-ai/dsh-terminal-bash`) | Shell backend over `ctx.subprocess.spawnTerminal`: readiness detection, bounded terminal state, sandbox policy, and session operations | registers on `ctx.terminals` |
| `tool-terminal` (`@deepseek-ai/dsh-tool-terminal`) | Six model-facing tools and generic task integration for background sends | registers on `ctx.tools` |

The design and deferred boundaries live in the [persistent PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md).

The subsystem reference — ids, backend/session contracts, send readiness, bounded reads — is [docs/subsystems/terminal.md](../../docs/subsystems/terminal.md); design and deferred boundaries in the [persistent PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md).
