# workspace/：workspace 实体家族

[English](README.md) | 中文

本家族拥有持久 workspace：带标题和有序会话成员关系的用户目录。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`workspace/`](workspace/README.md) | 注册 workspace 并记录其会话归属 | `ctx.workspaceRegistry` |

[workspace 包参考](workspace/README.md)负责生命周期、持久化和删除语义。

子系统参考——实体、realpath 规范、注册/解析——见 [docs/subsystems/workspace.md](../../docs/subsystems/workspace.md)；存储设计见 [domain KV 存储 Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)。
