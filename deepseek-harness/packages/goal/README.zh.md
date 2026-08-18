# goal/：持久化的同会话目标

[English](README.md) | 中文

agent 会话的持久目标状态，独立于消费它的面向模型工具与续行策略。goal 状态是所属会话日志的一部分；消费方依赖 `dsh-goal`，绝不依赖具体的 agent loop（智能体循环）。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`goal/`](goal/README.md) | 目标状态与生命周期 | `ctx.goals` |
| [`goal-round-driver/`](goal-round-driver/README.md) | 同会话目标续行 | 无 |
| [`tool-goal/`](tool-goal/README.md) | 面向模型的目标工具 | 无 |
| [`command-goal/`](command-goal/README.md) | 面向用户的目标命令 | 无 |

子系统参考——goal 标识、生命周期快照、激活、变更记录——见 [docs/subsystems/goal.md](../../docs/subsystems/goal.md)。
