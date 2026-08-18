# plan/：plan 协作状态

[English](README.md) | 中文

Plan mode 是按 agent（智能体）记录的协作状态，而不是通用模式注册表或能力 seam。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`plan-mode/`](plan-mode/README.md) | 负责 plan mode 状态、指引、命令和评审流程 | `ctx.planMode` |

[plan 专用协作状态](../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md)决策记录了该家族的设计。

子系统参考——`plan/mode` 折叠、步骤边界刷写、配置、退出工具——见 [docs/subsystems/plan.md](../../docs/subsystems/plan.md)；设计见[计划专属协作状态](../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md)。
