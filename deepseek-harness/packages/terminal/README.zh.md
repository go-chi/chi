# terminal/：持久 PTY 能力家族

[English](README.md) | 中文

`PTY` 的全称是 **Pseudo-Terminal（伪终端）**。这项能力提供持久且限定所有者范围的终端会话，适用于需要跨工具调用保留状态或使用交互式 stdin 的工作流。PTY 是单次 bash 与文件系统工具的补充，不会取代后两者更严格的逐操作约定。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`pty`](terminal/README.md)（`@deepseek-ai/dsh-terminal`） | 后端注册表、品牌化 id、精确的 Agent 所有权、会话操作与等待完成的清理 | `ctx.terminals` |
| `terminal-bash`（`@deepseek-ai/dsh-terminal-bash`） | `ctx.subprocess.spawnTerminal` 之上的 shell 后端：就绪检测、有界终端状态、沙箱策略与会话操作 | 注册到 `ctx.terminals` |
| `tool-terminal`（`@deepseek-ai/dsh-tool-terminal`） | 6 个面向模型的工具，并为后台发送集成通用任务 | 注册到 `ctx.tools` |

设计与暂缓边界记录在[持久 PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md) 中。

子系统参考——id、后端/会话约定、发送就绪、有界读取——见 [docs/subsystems/terminal.md](../../docs/subsystems/terminal.md)；设计与暂缓边界见[持久 PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md)。
