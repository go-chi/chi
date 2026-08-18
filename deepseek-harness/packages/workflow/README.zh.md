# workflow/：动态工作流能力家族

[English](README.md) | 中文

本家族通过 subagent 运行由模型编写的编排工作流，并将通用工具与固定策略工具公开给模型。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`workflow/`](workflow/README.md) | 定义工作流执行和生命周期事件 | `ctx.workflowEngine` |
| [`workflow-worker-thread/`](workflow-worker-thread/README.md) | 在线程中运行工作流脚本 | 注册到 `ctx.workflowEngine` |
| [`tool-workflow/`](tool-workflow/README.md) | 向模型公开通用工作流执行 | 注册到 `ctx.tools` |
| [`tool-ralph/`](tool-ralph/README.md) | 公开使用全新 agent（智能体）的固定 Ralph 工作流 | 注册到 `ctx.tools` |

worker thread 将工作流执行与宿主事件循环隔离，但不构成安全边界。参见[动态工作流](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)和 [Ralph 工具](../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md)决策。

子系统参考——启动请求、`WorkflowMeta`、结果、实时运行、`workflow/*` 事件——见 [docs/subsystems/workflow.md](../../docs/subsystems/workflow.md)；决策见[动态工作流](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)与 [Ralph 消费方](../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md) Agent Note。
