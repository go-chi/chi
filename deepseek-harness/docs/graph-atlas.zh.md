<!-- 英文源文件由 scripts/gen-doc-graphs.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-doc-graphs` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/graph-atlas.md` 重新记录配对。 -->

# 文档图索引

[English](graph-atlas.md) | 中文

这些图展示生成目录未包含的关系。可以用它们查找包之间的关系、能力 seam、事件流、面向模型的工具、应用组合和运行时生命周期路径。精确签名和类型定义仍以[子系统页面](subsystems/core.md)（类型和生成的 `cordis-surface` 区域）及[工具目录](tool-catalog.md)为准。

本索引背后的流程决策记录在[文档图 Agent Note](../.agents/notes/archived/process/2026-07-03-documentation-graph-atlas.md)中。

| 图 | 模式 |
| --- | --- |
| [模块依赖图](module-graph.md) | `generated` |
| [工具 schema 目录与包映射](tool-catalog.md) | `generated` |
| [能力 seam 与核心服务](capability-seams.md) | `hybrid generated` |
| [dsh 共享基础组合](../apps/cli/composition.md) | `hybrid generated` |
| [headless-agent 应用组合](../examples/headless-agent/composition.md) | `hybrid generated` |
| [acp-agent 应用组合](../examples/acp-agent/composition.md) | `hybrid generated` |
| [事件生产方／消费方矩阵](event-producer-consumer.md) | `hybrid generated` |
| [agent（智能体）轮次与步骤生命周期](agent-lifecycle.md) | `curated` |
| [工具执行流水线](tool-execution-pipeline.md) | `curated` |

运行 `pnpm run gen-doc-graphs` 可重新生成英文源文件；运行 `pnpm run verify-doc-graphs` 可验证英文源的新鲜度，中文对侧则通过双语配对维护。

英文源文件的维护模式为混合。每个链接页面都会声明其英文源模式为生成、混合或人工编写；本中文文件是通过双语配对维护的经评审对侧。
