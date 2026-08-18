# todo/：todo／规划能力家族

[English](README.md) | 中文

面向模型的 todo 能力。它是单一**产品**包，因为一个 agent（智能体）会话拥有该列表；不存在可替换的提供方约定。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`tool-todo/`](tool-todo/README.md) | 存储并公开会话的 todo 列表。 | （注册到 `ctx.tools`） |

子级 README 负责工具、持久化和渲染约定。

事件载荷记录在 [docs/subsystems/session.md](../../docs/subsystems/session.md)。
