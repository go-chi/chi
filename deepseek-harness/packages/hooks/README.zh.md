# hooks/ — 钩子桥接与共享协议

[English](README.md) | 中文

hooks 子系统让用户像使用 Claude Code 和 Codex 一样，在生命周期节点扩展 agent（智能体）：把桥接插件指向现有 `hooks.json`（或设置），即可忠实运行这些外部 shell 钩子。规范扩展接口本身是 harness 的类型化拦截点（参见[拦截扩展点 Agent Note](../../.agents/notes/implemented/feature/2026-06-30-interception-extension-points.md)）；「原生钩子」只是这些扩展点上的普通 Cordis 插件。这些包是把外部 shell 钩子协议转换到同一接口的**桥接**，也包括它们共同依赖的共享协议库。

| 包 | 职责 | 形态 |
|---|---|---|
| [`hook-protocol/`](hook-protocol/README.md) | 共享 shell 钩子协议库 | 库 |
| [`hooks-claude-code/`](hooks-claude-code/README.md) | Claude Code 钩子桥接 | 插件 |
| [`hooks-codex/`](hooks-codex/README.md) | Codex 钩子桥接 | 插件 |

共享库负责通用协议行为；各桥接负责自身方言的事件映射。子 README 记录这些约定。
