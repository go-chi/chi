# compaction/ — 压缩能力家族

[English](README.md) | 中文

一个压缩（compaction）能力家族（参见[能力 seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)）：Service Definition、摘要提供方、无模型工具结果修剪配套工具，以及用户命令 Consumer。这些全是**产品**包。

| 包 | 职责 | ctx key |
|---|---|---|
| [`compaction/`](compaction/README.md) | 压缩 seam 与事件词汇 | `ctx.compaction` |
| [`compaction-basic/`](compaction-basic/README.md) | token 压力与摘要后端 | 注册 `ctx.compaction` |
| [`compaction-tool-result-pruner/`](compaction-tool-result-pruner/README.md) | 可选的无模型工具结果修剪 | `ctx.toolResultPruner` |
| [`command-compact/`](command-compact/README.md) | 用户压缩命令 | 注册到 `ctx.commands` |

后端、可选修剪器和用户命令通过该 seam 组合；token 测量仍是独立的 LLM（大语言模型）家族服务。[压缩能力 seam Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md) 负责说明依赖关系的设计依据。

子系统参考——`compaction/*` 事件、`CompactionResult`、服务、修剪结果——见 [docs/subsystems/compaction.md](../../docs/subsystems/compaction.md)；seam 有意依赖 `dsh-session`/`dsh-llm` 的决定记录在[压缩能力 seam Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md)。
