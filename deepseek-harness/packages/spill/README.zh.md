# spill/：工具输出 spill 能力家族

[English](README.md) | 中文

本家族持久化过大的工具输出，并以有界预览和取回定位信息替换内联结果。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`spill/`](spill/README.md) | 定义 spill 存储 | `ctx.spillStore` |
| [`spill-local/`](spill-local/README.md) | 在会话范围的本地文件中存储 spill 文本 | 注册到 `ctx.spillStore` |
| [`spill-policy/`](spill-policy/README.md) | 应用执行后 spill 策略 | 监听 `ctx.tools` |

参见[工具输出 spill 决策](../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)，其中记录了存储、保留和工具自有输出处理之间的边界。

子系统参考——`SaveTextSpill`、所有者/来源、品牌化定位符——见 [docs/subsystems/spill.md](../../docs/subsystems/spill.md)；依据见[工具输出 spill Agent Note](../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)。
