# subagent/ — subagent capability family

English | [中文](README.zh.md)

This family lets an agent delegate work to child agents. Multiple named providers may coexist in one context.

| Package | Role | ctx key |
|---|---|---|
| [`subagent/`](subagent/README.md) | Defines provider registration, delegation, and continuation | `ctx.subagents` |
| [`subagent-inprocess/`](subagent-in-process-driver/README.md) | Provides the shared in-process run driver | — |
| [`subagent-spawn-in-process/`](subagent-spawn-in-process/README.md) | Starts a fresh in-process child | registers on `ctx.subagents` |
| [`subagent-fork-in-process/`](subagent-fork-in-process/README.md) | Starts an in-process child from the parent's completed history | registers on `ctx.subagents` |
| [`subagent-acp/`](subagent-acp/README.md) | Starts an out-of-process child over ACP | registers on `ctx.subagents` |
| [`subagent-codex/`](subagent-codex/README.md) | Starts a real Codex app-server child | registers on `ctx.subagents` |
| [`subagent-claude-code/`](subagent-claude-code/README.md) | Starts a real Claude Code child through the official Claude Agent SDK | registers on `ctx.subagents` |
| [`subagent-dsh-sdk/`](subagent-dsh-sdk/README.md) | Starts an out-of-process Harness child through the TypeScript SDK | registers on `ctx.subagents` |
| [`tool-subagent/`](tool-subagent/README.md) | Exposes delegation to the model | registers on `ctx.tools` |
| [`tool-subagent-control/`](tool-subagent-control/README.md) | Exposes child messaging and listing to the model | registers on `ctx.tools` |
| [`tool-subagent-report/`](tool-subagent-report/README.md) | Provides the child-to-parent report channel | registers in child scopes |

See the decisions for the [capability family](../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md), [continuable children](../../.agents/notes/implemented/feature/2026-07-21-continuable-background-subagents.md), and [control tools](../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.md).

The subsystem reference — start requests, results, live runs, the provider contract, continuable background children — is [docs/subsystems/subagent.md](../../docs/subsystems/subagent.md); design rationale in the [subagent capability seam](../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md), [continuable background subagents](../../.agents/notes/implemented/feature/2026-07-21-continuable-background-subagents.md), and [merged subagent control service](../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.md) Agent Notes.
