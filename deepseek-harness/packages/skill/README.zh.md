# skill/：skill（技能）能力家族

[English](README.md) | 中文

本家族发现可复用的 agent（智能体）指令，并通过与提供方无关的目录和 loader 将其公开给模型。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`skill/`](skill/README.md) | 定义 skill 提供方注册和查找 | `ctx.skills` |
| [`skill-badge/`](skill-badge/README.md) | 贡献可选的内置 dsh 徽章 skill | 注册到 `ctx.skills` |
| [`skill-filesystem/`](skill-filesystem/README.md) | 从本地文件系统发现 skill | 注册到 `ctx.skills` |
| [`tool-skill/`](tool-skill/README.md) | 发布 skill 目录和面向模型的 loader | 注册到 `ctx.tools` |

该能力位于核心控制主干之外，可以使用本地、嵌入式或远程提供方，而无需更改面向模型的约定。

子系统参考——发现优先级、目录快照、`skill` 加载器——见 [docs/subsystems/skills.md](../../docs/subsystems/skills.md)。
